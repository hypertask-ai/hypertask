import React, {
    useState,
    useEffect,
    forwardRef,
    useImperativeHandle,
  } from 'react'




  // eslint-disable-next-line react/display-name
  export const EmojiList = forwardRef((props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
  
    const selectItem = index => {
      const item = props.items[index]
  
      if (item) {
        props.command({ name: item.name })
      }
    }
  
    const upHandler = () => {
      setSelectedIndex(((selectedIndex + props.items.length) - 1) % props.items.length)
    }
  
    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % props.items.length)
    }
  
    const enterHandler = () => {
      selectItem(selectedIndex)
    }
  
    useEffect(() => setSelectedIndex(0), [props.items])
  
    useImperativeHandle(ref, () => {
      return {
        onKeyDown: x => {
          if (x.event.key === 'ArrowUp') {
            upHandler()
            return true
          }
  
          if (x.event.key === 'ArrowDown') {
            downHandler()
            return true
          }
  
          if (x.event.key === 'Enter') {
            enterHandler()
            return true
          }
  
          return false
        },
      }
    }, [upHandler, downHandler, enterHandler])
  
    return (
      
        props.items.length>0&&
      
        <div 
          style={{ fontWeight:"600"}}
          className={`relative px-[9px] rounded-[4px] bg-containerBackground border-[1px] border-light-black-border-1  py-[15px] text-content`}>
          {props.items.map((item, index) => (
            <button
              className={`text-white-black item ${index === selectedIndex ? 'bg-[#363A40] text-white' : ''}`}
              key={index}
              onClick={() => selectItem(index)}
            >
            { item.fallbackImage
                ? <img alt={item.name} src={item.fallbackImage} align="absmiddle" />
                : item.emoji
              }
              {item.name}
            </button>
          ))}
        </div>
      
    )
  })
