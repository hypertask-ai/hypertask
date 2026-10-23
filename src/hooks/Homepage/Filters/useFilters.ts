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

    const applyFilterAndSetCache = async(project:IProject,filterForThisProject:IFilterSettings, columnsOverride?: ISection[]) => {
      console.log("🚀 ~ applyFilterAndSetCache ~ filterForThisProject:", filterForThisProject)
   
      
      return await saveFilterAPI(project, filterForThisProject, columnsOverride)
    }

    function overrideFilter(type:TFilter,value:any){
      if (!_currentProject) return;
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
      if (!conditionToRun) throw new Error("No condition");
      const existingLabelFilterIndex = filterForThisProject.addedFilters.findIndex(filter => filter.type === type);
      if (existingLabelFilterIndex !== -1) {
        const existingLabelFilter = filterForThisProject.addedFilters[existingLabelFilterIndex];
        existingLabelFilter.searchPayload=[value]
      } else {
        filterForThisProject.addedFilters.push({
          type: type,
          searchPayload: [value],
          condition: conditionToRun
        });
      }
      applyFilterAndSetCache(_currentProject, filterForThisProject);

    }


    async function  addFilter(type:TFilter, value:any, columnsOverride?: ISection[]) {
      if (!_currentProject) return;
      
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
      if (!conditionToRun) throw new Error("No condition");
      
      const existingLabelFilterIndex = filterForThisProject.addedFilters.findIndex(filter => filter.type === type);
      
      if (existingLabelFilterIndex !== -1) {
        const existingLabelFilter = filterForThisProject.addedFilters[existingLabelFilterIndex];
        
        if (existingLabelFilter.searchPayload.find(x=>x.id===value.id)) {
          existingLabelFilter.searchPayload = existingLabelFilter.searchPayload.filter(item => item.id !== value.id);

          if (existingLabelFilter.searchPayload.length === 0) {
            filterForThisProject.addedFilters.splice(existingLabelFilterIndex, 1);
          }
        } else {
          existingLabelFilter.searchPayload.push(value);
        }
      } else {
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
      
      const filterForThisProject = getActiveFiltersFromProject(_currentProject);
      
      const conditionToRun = defaultConditions[type];
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

    async function toggleFilterValueMatch(type: TFilter, next?: TMatchFilters) {
      if (!_currentProject) return;
      const filters = getActiveFiltersFromProject(_currentProject);
      const existingFilter = filters.addedFilters.find((filter) => filter.type === type);
      if (!existingFilter?.searchPayload?.length) return;
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
