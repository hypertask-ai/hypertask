import { activeSectionAtom, currentProjectAtom, activeItemAtom } from '@/store';
import { useRecoilState, useSetRecoilState } from '@/lib/state';
import { useStore } from 'jotai';
import UpdateKanban from '../MultiPages/useUpdateTaskInBoards';
import { ISection } from '@/models/model';
import { scrollToCenterIfNear, scrollToCenterIfNearBottom, scrollToCenterIfNearTop } from '@/utils/helperFunctions/helperFunctions';

const useHandleFocus = (filteredSections: ISection[]) => {
  const store = useStore();
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const [_currentProject, __] = useRecoilState(currentProjectAtom)
  const getActiveSection = () => store.get(activeSectionAtom);
  const getActiveItem = () => store.get(activeItemAtom);

  const { updateActiveItemAndItemInView } = UpdateKanban();

  const refocus = (itmId: number) => document.getElementById('task-' + itmId)?.focus();

  const moveFocusToSection = (index: number, itemIndex?: number) => {
    console.log("🚀 ~ moveFocusToSection ~ index:", index)
    // console.log("🚀 ~ moveFocusToSection ~ index:", index)
    if (!_currentProject) return
    const sectionEls = document.getElementById("sectionsContainer")!.children;
    // console.log("🚀 ~ moveFocusToSection ~ sectionEls:", sectionEls)
    if (index >= 0 && index < sectionEls.length) {
      // @ts-ignore
      sectionEls[index].focus();
      // setActiveSection(parseInt(sectionEls[index]?.id.split("-")[2]))
      setActiveSection(index)
      var ItemId = null;
      // sectionEls[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
      const sectionLength = filteredSections[index].items.length
      // console.log("🚀 ~ moveFocusToSection ~ sectionLength:", sectionLength)
      // console.log("🚀 ~ moveFocusToSection ~ sectionLength<itemIndex!+1:", sectionLength<itemIndex!+1)
      if (sectionLength > 0) {
        // console.log("🚀 ~ file: index.tsx:239 ~ moveFocusToSection ~ itemIndex:", itemIndex)

        if (sectionLength < itemIndex! + 1) {
          const item = filteredSections[index].items[sectionLength - 1]
          updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection())
          ItemId = item.id


        }
        else if (itemIndex) {
          const item = filteredSections[index].items[itemIndex]
          updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection())
          ItemId = item.id
        }
        else {
          const item = filteredSections[index].items[0]
          updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection())
          ItemId = item.id
        }
      } else {
        // console.log("scroll into view")
        document.getElementById("header")?.scrollIntoView({ block: 'start', behavior: "smooth" })
        updateActiveItemAndItemInView(null, _currentProject.id, getActiveSection())

      }
    }
    else {
      updateActiveItemAndItemInView(null, _currentProject.id, getActiveSection())
    }
    console.log("🚀 ~ moveFocusToSection ~ ItemId:", ItemId)

    if (ItemId) {
      refocus(ItemId)

      const element = document.getElementById(`task-${ItemId}`)
      // console.log("🚀 ~ moveFocusToSection ~ element:", element)
      element && scrollToCenterIfNear(element, 10)
      // document.getElementById('task-' + ItemId)?.scrollIntoView({  block: 'center' ,inline: "center", behavior:"smooth" as ScrollBehavior});

    }
    else {
      const element = sectionEls[index] as HTMLElement
      scrollToCenterIfNear(element)
    }
  }

  // [l] for focus to right
  const moveFocusToRight = () => {

    const sectionEls = document.getElementById("sectionsContainer")!.children;
    // console.log("ALL SECTION",sectionEls);

    const activeElement = document.activeElement;
    // console.log("Active Element - Prev.State",activeElement);

    const parentNode = activeElement?.parentNode;
    const activeElementIndex = Array.from(sectionEls).indexOf(activeElement!);
    // console.log("Section Index -1 for 0th", activeElementIndex);

    const activeElementInSection = Array.from(parentNode?.children!).indexOf(activeElement!);
    // console.log("Active Section Index-1", activeElementInSection);
    // console.log(_activeItem)
    const activeItem = getActiveItem();
    if (activeElementIndex === -1 || activeElementIndex === sectionEls.length - 1) {
      if (activeItem && activeElementIndex === -1) {
        // console.log("Task_ID of ActiveElem", _activeItem);
        const filter = filteredSections.filter(s => {
          // console.log("Total Columns", _sections);
          const _filter = s.items.filter(i => i.id === activeItem);
          return _filter && _filter.length > 0
        })
        if (filter && filter.length > 0) {
          const _index = filteredSections.indexOf(filter[0])
          // console.log("🚀 ~ file: Homepage.tsx:637 ~ moveFocusToRight ~ _index:", _index)
          if (_index === sectionEls.length - 1) {
            // moveFocusToSection(0)
          }
          else
            moveFocusToSection(_index + 1, activeElementInSection)
        } else {
          moveFocusToSection(0)
        }
      }

      else if (activeElementIndex !== sectionEls.length - 1) {
        moveFocusToSection(0)
      }
    }

    else {

      moveFocusToSection(activeElementIndex + 1, 0)
    }
  };


  // [h] to move focus to left
  const moveFocusToLeft = () => {

    const now = new Date().getTime();
    //  from right to left
    // if (lastgClick.current && now - lastgClick.current < 5000) return
    const sectionEls = document.getElementById("sectionsContainer")!.children;
    const activeElement = document.activeElement;
    const activeElementIndex = Array.from(sectionEls).indexOf(activeElement!);

    const parentNode = activeElement?.parentNode;
    const activeElementInSection = Array.from(parentNode?.children!).indexOf(activeElement!);
    const activeItem = getActiveItem();

    if (activeElementIndex <= 0) {
      if (activeItem && activeElementIndex === -1) {
        const filter = filteredSections.filter(s => {
          const _filter = s.items.filter(i => i.id === activeItem);
          return _filter && _filter.length > 0
        })
        if (filter && filter.length > 0) {
          const _index = filteredSections.indexOf(filter[0])
          if (_index <= 0) {
            // moveFocusToSection(sectionEls.length - 1)
          }
          else {
            moveFocusToSection(_index - 1, activeElementInSection)
          }
        } else {
          moveFocusToSection(sectionEls.length - 1)
        }
      } else {
        // moveFocusToSection(sectionEls.length - 1)
      }
    } else {
      moveFocusToSection(activeElementIndex - 1)
    }
  };


  const moveFocusWhenNoActive = () => {

    if (!_currentProject) return
    for (var i = 0; i < filteredSections.length; i++) {
      if (filteredSections[i].items.length > 0) {
        const item = filteredSections[i].items[0]
        const sectionEls = document.getElementById("sectionsContainer")!.children;
        // @ts-ignore
        sectionEls[i].focus()
        updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection());
        break;
      }
    }
  }


  // [j] for arrow down

  const ArrowDownHandler = (e: any) => {
    e.key === "ArrowDown" && e.preventDefault();
    const activeElement = document.activeElement;

    const tasksList = document?.getElementById(`tasks-list-${getActiveSection()}`)?.children;
    if (tasksList && tasksList.length > 0 && activeElement) {
      const index = Array.from(tasksList).indexOf(activeElement);
      if (index === -1) {
        document.getElementById(tasksList[0].id)?.focus()
      } else if (index === tasksList.length - 1) {
        // tasksList[0].focus();
      } else {
        const activeElement_ = document.getElementById(tasksList[index + 1].id)
        console.log("🚀 ~ ArrowDownHandler ~ activeElement_:", activeElement_)
        activeElement_ && scrollToCenterIfNearBottom(activeElement_, 15)
        activeElement_?.focus()
        // document.getElementById(tasksList[index + 1].id)?.scrollIntoView({  block: 'center',inline:"end",behavior:"instant"})

      }
    }
  }


  // [k] for arrow up
  const ArrowUpHandler = (e: any) => {
    const now = new Date().getTime();

    const activeElement = document.activeElement;
    e.key === "ArrowUp" && e.preventDefault();
    const tasksList = document?.getElementById(`tasks-list-${getActiveSection()}`)?.children;
    if (tasksList && tasksList.length > 0 && activeElement) {
      const index = Array.from(tasksList).indexOf(activeElement);
      if (index === -1) {
        document.getElementById(tasksList[0].id)?.focus()

      } else if (index === 0) {
        // tasksList[tasksList.length - 1].focus();
      } else {
        // document.getElementById(tasksList[index].id)?.scrollIntoView({behavior:"smooth", block:"end"})
        const activeElement_ = document.getElementById(tasksList[index - 1].id)
        activeElement_ && scrollToCenterIfNearTop(activeElement_, 30)
        activeElement_?.focus()
        if (index - 1 === 0) document.getElementById(tasksList[0].id)?.scrollIntoView({ block: "center" })

        // document.getElementById(tasksList[index - 1].id)?.scrollIntoView({  block: 'end',behavior:"instant"})

        // if (document.activeElement?.id===activeElement.id){
        //   document.getElementById(tasksList[index].id)?.focus()
        // }
      }
    }

  }

  return { moveFocusToRight, moveFocusToLeft, moveFocusWhenNoActive, refocus, ArrowUpHandler, ArrowDownHandler }
}

export default useHandleFocus
