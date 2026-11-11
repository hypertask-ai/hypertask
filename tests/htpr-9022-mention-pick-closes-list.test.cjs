const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function harness() {
  const popups = [];
  const commands = [];
  const components = [];

  class ReactRenderer {
    constructor(component, options) {
      this.component = component;
      this.options = options;
      this.element = { nodeType: 1 };
      this.ref = { onKeyDown: () => false };
      components.push(this);
    }
    updateProps(props) {
      this.options.props = props;
    }
    destroy() {
      this.destroyed = true;
    }
  }

  const tippy = () => {
    const instance = {
      destroyed: false,
      hidden: false,
      destroy() {
        instance.destroyed = true;
      },
      hide() {
        instance.hidden = true;
      },
      setProps() {},
    };
    popups.push([instance]);
    return [instance];
  };

  const { createMentionData } = loadModule("src/components/RTE/Components/AI_Chat/MentionData.js", {
    "@tiptap/react": { ReactRenderer },
    "tippy.js": { default: tippy },
    "../../Components/AI_Chat/MentionList": { default: function MentionList() {} },
    axios: { default: { get: async () => ({ data: [] }) } },
    "../../suggestionAnchor": { stableClientRect: () => () => ({}) },
    "../../mentionCommand": {
      mentionCommand: (props) => {
        commands.push(props);
      },
    },
  });

  return { createMentionData, popups, commands, components };
}

const startProps = () => ({
  editor: { doc: "editor" },
  range: { from: 1, to: 4 },
  query: "qa",
  clientRect: () => ({ top: 0, left: 0, width: 10, height: 10 }),
});

const pick = (suggestion, mentionData) =>
  suggestion.command({ editor: { doc: "editor" }, range: { from: 1, to: 4 }, props: mentionData });

test("picking an agent mention from the AI chat list closes the picker", () => {
  const { createMentionData, popups, commands } = harness();
  const suggestion = createMentionData(() => {});
  const renderer = suggestion.render();

  renderer.onStart(startProps());
  assert.equal(popups.length, 1);
  assert.equal(popups[0][0].destroyed, false);

  pick(suggestion, { id: "agent-1", text: "QA 7028 agent", label: "agent" });

  assert.equal(popups[0][0].destroyed, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].props.label, "agent");
});

test("the picker stays closed when the suggestion updates after a pick", () => {
  const { createMentionData, popups } = harness();
  const suggestion = createMentionData(() => {});
  const renderer = suggestion.render();
  const props = startProps();

  renderer.onStart(props);
  renderer.onUpdate({ ...props, query: "qa " });
  pick(suggestion, { id: "task-1", label: "task" });
  renderer.onUpdate({ ...props, query: "qa" });

  assert.equal(popups.length, 1);
  assert.equal(popups[0][0].destroyed, true);
});

test("escape and exit after a pick do not throw when the picker is gone", () => {
  const { createMentionData } = harness();
  const suggestion = createMentionData(() => {});
  const renderer = suggestion.render();

  renderer.onStart(startProps());
  pick(suggestion, { id: "agent-1", label: "agent" });

  assert.equal(renderer.onKeyDown({ event: { key: "Escape" } }), true);
  renderer.onExit();
});
