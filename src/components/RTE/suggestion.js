import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { EmojiList } from './EmojiList'
import { stableClientRect } from "./suggestionAnchor";

// eslint-disable-next-line import/no-anonymous-default-export
export default {
  items: ({ editor, query }) => {
    return editor.storage.emoji.emojis
      .filter(({ shortcodes, tags }) => {
        return (
          shortcodes.find(shortcode => shortcode.startsWith(query.toLowerCase()))
          || tags.find(tag => tag.startsWith(query.toLowerCase()))
        )
      })
      .slice(0, 5)
  },

  allowSpaces: false,

  render: () => {
    let component
    let popup
    let getClientRect;
    const anchor = stableClientRect(() => getClientRect?.());

    return {
      onStart: props => {
        getClientRect = props.clientRect;
        component = new ReactRenderer(EmojiList, {
          props,
          editor: props.editor,
        })

        popup = tippy('body', {
          getReferenceClientRect: anchor,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate(props) {

        getClientRect = props.clientRect;
        component.updateProps(props)

        popup[0].setProps({
          getReferenceClientRect: anchor,
        })
      },

      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup[0].hide()
          component?.destroy()

          return true
        }

        return component.ref?.onKeyDown(props)
      },

      onExit() {
        popup&&popup[0]?.destroy();
        component?.destroy()
      },
    }
  },
}