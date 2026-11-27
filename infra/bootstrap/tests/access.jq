# Contract checks on the compiled ARM template of infra/bootstrap/main.bicep (see run.sh): the
# custom role and the role assignments of the nightly backup identity.
#
#   jq -r --arg container table-backups -f infra/bootstrap/tests/access.jq main.json
#
# $container is the backup container of infra/app/backup.bicep (variable containerName). Prints
# "group<TAB>name" and "ok<TAB>description" or "FAIL<TAB>description" per check, like
# infra/app/tests/template.jq.

def role: .resources[] | select(.type == "Microsoft.Authorization/roleDefinitions");
def access: .resources[]
  | select(.type == "Microsoft.Resources/deployments" and .name == "bootstrap-app-rg-access")
  | .properties.template;
def assignment: access.resources[] | select(.type == "Microsoft.Authorization/roleAssignments");
def blob($action): "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/\($action)";
# Whitespace-insensitive form of a condition (the template keeps the readable multi-line form).
def norm: gsub("\\s+"; " ") | gsub("\\( "; "(") | gsub(" \\)"; ")") | ltrimstr(" ") | rtrimstr(" ");
def check($description; f): {description: $description, ok: (try ([f] == [true]) catch false)};
def group($name): {group: $name};

($container | tostring) as $c
| "@Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringEquals '\($c)'"
  as $inContainer
| "ActionMatches{'\(blob("read"))'}" as $read
| ("((!(\($read) AND NOT SubOperationMatches{'Blob.List'})) OR (\($inContainer) AND"
  + " @Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs:isCurrentVersion]"
  + " BoolEquals true)) AND ((!(\($read) AND SubOperationMatches{'Blob.List'})) OR"
  + " (\($inContainer)))") as $expectedCondition
| [
  group("custom role WeddingPlanner Backup Writer"),
  check("one definition, only where the nightly backup runs (test, production)";
    [role] | length == 1 and .[0].condition == "[variables('backupEnabled')]"),
  check("no management actions";
    role.properties.permissions | length == 1 and .[0].actions == [] and .[0].notActions == []),
  check("data actions: write new blobs and read blobs, nothing else";
    role.properties.permissions[0].dataActions | sort
    == ([blob("add/action"), blob("read"), blob("write")] | sort)),
  check("no delete, no table data, no wildcard";
    [role.properties.permissions[0].dataActions[] | select(test("delete|tableServices|\\*"; "i"))]
    == [] and role.properties.permissions[0].notDataActions == []),
  check("assignable at this subscription only";
    role.properties.assignableScopes == ["[subscription().id]"]),

  group("role assignments in the app resource group"),
  check("the backup container in infra/app/backup.bicep is known"; $c | test("^[a-z0-9-]{3,63}$")),
  check("the condition limits blob reads to current versions, listing to the backup container";
    (access.variables.backupReadCondition | norm) == $expectedCondition),
  check("the condition sits on the Backup Writer assignment of the backup identity, and only there";
    access.variables.backupAssignments
    | test("'roleId', parameters\\('backupWriterRoleId'\\), 'description', '[^']*', 'condition', variables\\('backupReadCondition'\\)\\)")
      and ([scan("'condition'")] | length) == 1),
  check("deploy identity and owner assignments carry no condition";
    access.variables.assignments | all(has("condition") | not)),
  check("assignments pass the condition with condition version 2.0 when there is one";
    assignment.properties
    | (.condition | test("tryGet\\(.*'condition'\\)"))
      and .conditionVersion == "[if(empty(tryGet(concat(variables('assignments'), variables('backupAssignments'))[copyIndex()], 'condition')), null(), '2.0')]"),
  check("the backup identity gets Reader, Storage Table Data Reader and Backup Writer only";
    [access.variables.backupAssignments | scan("variables\\('roles'\\)\\.([A-Za-z]+)") | .[0]]
    == ["reader", "storageTableDataReader"]
    and ([access.variables.backupAssignments | scan("'roleId', ")] | length) == 3)
]
| .[]
| if has("group") then "group\t\(.group)"
  else "\(if .ok then "ok" else "FAIL" end)\t\(.description)" end
