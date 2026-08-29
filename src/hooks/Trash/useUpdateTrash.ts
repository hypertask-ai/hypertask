import globalConstants from '@/lib/constants'
import { IProject } from '@/models/model'
import { useQueryClient } from '@tanstack/react-query'
import axios, { AxiosResponse } from 'axios';
import toast from 'react-hot-toast';

interface IRemoveFromTrash {
  projectId:number;
  taskId:number;
  mode:"recover"|"delete"
}


const useUpdateTrash = () => {
  const queryClient = useQueryClient()

  const removeFromTrash = async ({ projectId, taskId, mode }: IRemoveFromTrash) => {
    console.log("🚀 ~ removeFromTrash ~ taskId:", taskId);
    const queryKey = [globalConstants.TrashKeyPrefix, projectId];
    let allData: IProject | undefined = await queryClient.getQueryData(queryKey);
    if (!allData) return false; // Return false if no data is found

    // Create a new tasks list by filtering out the task to be removed
    // This ensures we're not mutating the original tasks array
    const newTasksList = allData.tasks?.filter(x => x.id !== taskId);


    // ============= based on mode. delete or recover task
    let response:AxiosResponse<any, any>;
    if (mode ==="delete"){
      response = await axios.delete(globalConstants.invokeTaskDeleteRoute + `?taskId=${taskId}`)
      if (response.status===200){
        toast("The task has been permanently deleted")
        // Create a new version of allData with the updated tasks list
        // This is done using destructuring and spreading to ensure immutability
        const updatedAllData = {
            ...allData,
            tasks: newTasksList,
        };
        // Update the state with the new data
        // await queryClient.setQueryData(queryKey, updatedAllData);
        queryClient.refetchQueries({queryKey:queryKey})
        return true; // Return true to indicate success
      }
    }

    else if (mode ==="recover"){
      response = await axios.post(globalConstants.invokeTaskRecoverRoute,{taskId})
      if (response.status===200){
        toast("The task has been recovered. Please visit the board again to view it.")

        // Create a new version of allData with the updated tasks list
        // This is done using destructuring and spreading to ensure immutability
        const updatedAllData = {
            ...allData,
            tasks: newTasksList,
        };
        // Update the state with the new data
        // await queryClient.setQueryData(queryKey, updatedAllData);
        queryClient.refetchQueries({queryKey:queryKey})
        return true; // Return true to indicate success
      }
    }

};



  return {removeFromTrash}
}

export default useUpdateTrash


