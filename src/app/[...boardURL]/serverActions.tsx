"use server"


import prisma from "@/lib/prisma";


import { IProject, ISection, ITask, IUser } from "@/models/model"
import notificationGetCount from "@/utils/controllers/notifications/getCount"
import getAll from "@/utils/controllers/projects/getAll"
import { getCurrentProject } from "@/utils/helperFunctions/helperFunctions"
import getAllMinimal from '@/utils/controllers/projects/getAllMinimal';
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

export const getAllProjects  = async(
    userObj:IUser,
    slugs:string,
    minimal?:boolean
  
  )=>{
      var response;
      // ============== GET ALL PROJECTS
      if (minimal){
        response = await getAllMinimal(userObj?.id!, "ExtraMinimal") // extra minimal so we only get ids that we're ultimately looking for
      }
      else{
        response = await getAll(userObj?.id!, )
      }
      const allProjects = JSON.stringify(response.json)
    
      // ============== GET CURRENT PROJECT
      const projects:IProject[] = JSON.parse(allProjects)
      const targetId =parseInt(slugs)
      const index = projects.findIndex((project) => project.id.toString() === targetId.toString()); // projects.ids
    
      // ============== GET PROJECT SECTIONS
      const updatedProjects = [...projects];
      
      async function fetchSectionsForProjects() {
        for (let index = 0; index < updatedProjects.length; index++) {
          const project = projects[index];
          const sections = getCurrentProject(project);
          
          const { _sections, firstTask } = sections as {
            _sections: ISection[];
            firstTask: ITask | null;
          };
          
          // Set the sections attribute inside the project
        updatedProjects[index].sections = _sections;
        updatedProjects[index].firstTask = firstTask
      }
    }
      const notificationsCount = await notificationGetCount(userObj.id)
    
      // Call the function to fetch sections for all projects and update them, only if minimal isn't requested
      if (!minimal) await fetchSectionsForProjects();
      return ({
        index:index,
        updatedProjects:updatedProjects,
        notificationsCount:notificationsCount
      })
  }
  

export const getTaskServer = async(taskId:number)=>{
  const copied = await prisma.task.findFirst({
    where:{id:taskId}
    })
    console.log("🚀 Copied Task to clipboard: ", copied)
    
  return copied
}

export const getAllSubTasks = async (taskId: number) => {
  let allTasks: number[] = [];

  const getTask = async (taskId: number) => {
    console.log("getting all Sub-Tasks (including Parent)");
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id:true,
          subTasks: {
            orderBy: {
              status: "desc",
            },
          },
        }
      });
      if (!task)return
      allTasks.push(task.id);
      if (task?.subTasks && task.subTasks.length > 0) {
        for (const subTask of task.subTasks) {
          await getTask(subTask.id);
        }
      }
    } catch (error) {
      console.log("🚀 ~ getAllSubTasks ~ error:", error);
    }
  };

  try {
    console.time("sub-task prefetching on delete");
    await getTask(taskId);
    console.timeEnd("sub-task prefetching on delete");
    console.log("🚀 ~ getAllSubTasks ~ tasks:", allTasks)

    return allTasks;
  } catch (error) {
    console.log("🚀 ~ getAllSubTasks ~ error:", error)
  }
};

export const getNewView = async(viewSlug: string | undefined, projectViewId: string | undefined) =>{
  try{
    if(!viewSlug || !projectViewId) return undefined
    const view = await prisma.view.findFirst({
      where:{
        slug: { equals: viewSlug },
        project_view_id: projectViewId,
      },
    })
    return sanitizeViewBoardFilters(view)
  }catch(error){
    console.log("🚀 ~ getNewView ~ error:", error)
    return undefined
  }
}

export const switchToNewView = async (
  projectId: number,
  newViewId: string,
  userId: number
) => {
  try {
    if (!projectId || !userId || !newViewId) return undefined;
    const project_View = await prisma.project_View.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });
    console.log("🚀 ~ project_View:", project_View)

    const updatedUserProjectView = await prisma.user_Project_View.upsert({
      create: {
        // ... data to create a User_Project_View
        userId: userId,
        project_view_id: project_View.id,
        appliedViewId: newViewId,
      },
      update: {
        // ... if the newviewId is the default board, then simply set appliedView and unsaved as null
        appliedViewId:
          project_View.default_view_id === newViewId ? null : newViewId,
      },
      where: {
        // ... the filter for the User_Project_View we want to update
        user_project: {
          userId: userId,
          project_view_id: project_View.id,
        },
      },
    });
    const currentDate = new Date();

    await prisma.view.update({
      where: {
        id: newViewId,
      },
      data: {
        lastUsedAt: currentDate,
      },
    });

    await prisma.view_Last_Used.upsert({
      create: {
        userId: userId,
        viewId: newViewId,
        lastUsedAt: currentDate,
      },
      update: {
        lastUsedAt: currentDate,
      },
      where: {
        user_view_last_used: {
          userId: userId,
          viewId: newViewId,
        },
      },
    });

    if (updatedUserProjectView.unsavedViewId)
      await prisma.view.delete({
        where: {
          id: updatedUserProjectView.unsavedViewId,
        },
      });
    // const project_view_updated = await getProjectView(projectId, currentUser.id)

    return 1;
  } catch (error) {
    console.log("🚀 ~ switchToNewView ~ error:", error);
    return undefined;
  }
};

export const resetToDefaultCurrent = async (projectId: number, mode: "ResetToDefault"|  "ResetCurrent", currentUser: IUser) =>{

  try {
      if (!currentUser || !projectId) return undefined
      const project_View = await prisma.project_View.upsert({where:{projectId},create:{projectId},update:{}})
      var toRemove = {}
      if (mode==="ResetCurrent"){
          toRemove = {}
      }
      else if (mode==="ResetToDefault"){
          toRemove = {appliedViewId:null}

      }

      const promise1= await prisma.user_Project_View.update({
          where: {
              user_project:{
                  userId:currentUser.id,
                  project_view_id:project_View.id
              }
          },
          data:toRemove
      })
      if (promise1.unsavedViewId) await  prisma.view.delete({
          where:{
              id:promise1.unsavedViewId
          }
      })
      const project_view_updated = await getProjectView(projectId, currentUser.id)

      
      return project_view_updated
  } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return undefined
  }
}
