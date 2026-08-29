const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(
  path.join(root, 'tests/mcp-custom-fields-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
);

const {
  ListCustomFieldsInputSchema,
  SetCustomFieldValueInputSchema,
} = jiti(
  path.join(
    root,
    'src/lib/mcp-server/validations/custom-field.validation.ts'
  )
);
const { MCP_TOOLS } = jiti(
  path.join(root, 'src/lib/mcp-server/tools/index.ts')
);

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('both custom-field tools are registered in MCP_TOOLS', () => {
  const names = new Set(MCP_TOOLS.map((tool) => tool.name));
  assert.equal(names.has('hypertask_list_custom_fields'), true);
  assert.equal(names.has('hypertask_set_custom_field_value'), true);
});

test('list custom fields requires a board identifier', () => {
  assert.equal(ListCustomFieldsInputSchema.safeParse({}).success, false);
  assert.deepEqual(ListCustomFieldsInputSchema.parse({ project_id: '15' }), {
    project_id: 15,
  });
});

test('set custom field value requires task, field, and value identifiers', () => {
  assert.equal(SetCustomFieldValueInputSchema.safeParse({}).success, false);
  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      field_name: 'ICE',
      value: 21,
    }).success,
    false,
    'task_id is required'
  );
  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      task_id: 5118,
      value: 21,
    }).success,
    false,
    'a field identifier is required'
  );
  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      task_id: 5118,
      field_name: 'ICE',
    }).success,
    false,
    'value is required even when clearing'
  );

  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      task_id: 5118,
      field_id: 'field-uuid',
      value: 21,
    }).success,
    true
  );
  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      task_id: 5118,
      field_name: 'ICE',
      value: null,
    }).success,
    true,
    'null is a valid explicit clear value'
  );
  assert.equal(
    SetCustomFieldValueInputSchema.safeParse({
      task_id: 5118,
      field_id: 'field-uuid',
      field_name: 'ICE',
      value: 21,
    }).success,
    false,
    'field_id and field_name are mutually exclusive'
  );
});

test('set response type mirrors the route customField plus customFieldValue shape', () => {
  const route = read('src/app/api/mcp/custom-fields/value/route.ts');
  const service = read(
    'src/lib/mcp-server/lib/services/custom-field.service.ts'
  );

  assert.match(
    route,
    /customField:\s*\{[\s\S]*?id: customField\.id,[\s\S]*?name: customField\.name,[\s\S]*?type: customField\.type,[\s\S]*?\},[\s\S]*?customFieldValue,/,
    'the route returns a nested customField and customFieldValue'
  );
  assert.match(
    service,
    /customField:\s*\{[\s\S]*?id: string;[\s\S]*?name: string;[\s\S]*?type: CustomFieldType;[\s\S]*?\}\s*\| null;/,
    'customField must be nested and nullable when clearing an unknown name'
  );
  assert.match(
    service,
    /customFieldValue: CustomFieldValue \| null;/,
    'customFieldValue must be nullable when the value is cleared'
  );
  assert.doesNotMatch(
    service,
    /\bfieldValue:/,
    'the response must not use the old flat fieldValue shape'
  );
});

test('shared route preserves agent board access and auto-create-on-set', () => {
  const route = read('src/app/api/mcp/custom-fields/value/route.ts');

  assert.match(
    route,
    /validateProjectAccess\(\s*task\.projectId,\s*ctx\.user\.id,\s*ctx\.agentId\s*\)/,
    'agent tokens must be checked against the task board'
  );
  assert.match(
    route,
    /!customField\s*&&\s*normalizedValue !== null\s*&&\s*normalizedValue !== ""[\s\S]*?createCustomField\(\s*task\.projectId,\s*trimmedFieldName,\s*CustomFieldType\.Number/,
    'a missing field name must keep the CLI auto-create behavior'
  );
});
