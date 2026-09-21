import { TFilter, IFilterSettings, TMatchFilters  } from "@/models/Filters/model"
import { defaultFilterSettings, defaultConditions } from "@/utils/helperFunctions/Views/FilterHelperFunctions"
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { IProject, ISection } from "@/models/model";
import useKanbanViews from "../Views/useKanbanViews";


const useFilters = ()=>{
    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    const { saveFilterAPI } = useKanbanViews(_currentProject)



    // ========== just set the filter in local storage, apply them on the projectId provided and update the cache
    const applyFilterAndSetCache = async(project:IProject,filterForThisProject:IFilterSettings, columnsOverride?: ISection[]) => {
      console.log("🚀 ~ applyFilterAndSetCache ~ filterForThisProject:", filterForThisProject)
   
      
      // Returned, not fire-and-forget: the match-mode toggle chains on this promise to keep two
      // quick presses from racing, and that chain is meaningless if the save is not awaited.
      return await saveFilterAPI(project, filterForThisProject, columnsOverride)
    }

    function overrideFilter(type:TFilter,value:any){
      if (!_currentProject) return;
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
      // console.log("🚀 ~ addFilter ~ conditionToRun:", conditionToRun);
      if (!conditionToRun) throw new Error("No condition");
      const existingLabelFilterIndex = filterForThisProject.addedFilters.findIndex(filter => filter.type === type);
      if (existingLabelFilterIndex !== -1) {
        // If filter exists, remove value if it's present
        // const existingLabelFilter = filterForThisProject.addedFilters[existingLabelFilterIndex];
        const existingLabelFilter = filterForThisProject.addedFilters[existingLabelFilterIndex];
        existingLabelFilter.searchPayload=[value]
      } else {
        // If there's no existing filter, create a new one
        filterForThisProject.addedFilters.push({
          type: type,
          searchPayload: [value],
          condition: conditionToRun
        });
      }
      applyFilterAndSetCache(_currentProject, filterForThisProject);

    }


    // =============== checks if filter is present or not .
    // =============== which condition the filter would need, 
    // =============== adds the filter without causing duplicates
    async function  addFilter(type:TFilter, value:any, columnsOverride?: ISection[]) {
      if (!_currentProject) return;
      
      // If there is no filter, create one
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
      // console.log("🚀 ~ addFilter ~ conditionToRun:", conditionToRun);
      if (!conditionToRun) throw new Error("No condition");
      
      const existingLabelFilterIndex = filterForThisProject.addedFilters.findIndex(filter => filter.type === type);
      
      if (existingLabelFilterIndex !== -1) {
        // If filter exists, remove value if it's present
        const existingLabelFilter = filterForThisProject.addedFilters[existingLabelFilterIndex];
        
        if (existingLabelFilter.searchPayload.find(x=>x.id===value.id)) {
          // Remove the value if it's already present
          existingLabelFilter.searchPayload = existingLabelFilter.searchPayload.filter(item => item.id !== value.id);

          // If searchPayload becomes empty, remove the filter
          if (existingLabelFilter.searchPayload.length === 0) {
            filterForThisProject.addedFilters.splice(existingLabelFilterIndex, 1);
          }
        } else {
          // If value is not present, add it
          existingLabelFilter.searchPayload.push(value);
        }
      } else {
        // If there's no existing filter, create a new one
        filterForThisProject.addedFilters.push({
          type: type,
          searchPayload: [value],
          condition: conditionToRun
        });
      }
    
     await applyFilterAndSetCache(_currentProject, filterForThisProject, columnsOverride);
    }

    function removeFilter (type:TFilter){
       if (!_currentProject) return;
      
      // If there is no filter, create one
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
      // console.log("🚀 ~ addFilter ~ conditionToRun:", conditionToRun);
      if (!conditionToRun) throw new Error("No condition");

      const existingLabelFilterIndex = filterForThisProject.addedFilters.findIndex(filter => filter.type === type);
      if (existingLabelFilterIndex !== -1) filterForThisProject.addedFilters.splice(existingLabelFilterIndex, 1);
      
      applyFilterAndSetCache(_currentProject, filterForThisProject);

    }
    
    


    function toggleFilterMatchOptions (){
      if (!_currentProject)return
        const filters = getActiveFiltersFromProject(_currentProject)
        applyFilterAndSetCache(_currentProject,{...filters, matchFilters:filters.matchFilters==="ALL"?"ANY":"ALL"})

    }

    // Only flips a filter that already has values. Adding one with an empty searchPayload would be
    // actively harmful: every condition short-circuits to true on an empty payload, and under the
    // default "match ANY filters" that one always-true filter makes the whole board pass, silently
    // disabling every other filter the user has set.
    async function toggleFilterValueMatch(type: TFilter, next?: TMatchFilters) {
      if (!_currentProject) return;
      const filters = getActiveFiltersFromProject(_currentProject);
      const existingFilter = filters.addedFilters.find((filter) => filter.type === type);
      if (!existingFilter?.searchPayload?.length) return;
      // `next` is explicit so two presses before the save round-trips do not both read the same
      // stale mode and write the same value; the caller tracks what it last asked for.
      existingFilter.match = next ?? (existingFilter.match === "ALL" ? "ANY" : "ALL");
      return await applyFilterAndSetCache(_currentProject, filters);
    }

    function resetFilters (){
      if(!_currentProject) return
      applyFilterAndSetCache(_currentProject, defaultFilterSettings)

    }


    return {
      addFilter,
      resetFilters,
      toggleFilterMatchOptions,
      toggleFilterValueMatch,
      overrideFilter,
      removeFilter
    }
    
}

export default useFilters;
