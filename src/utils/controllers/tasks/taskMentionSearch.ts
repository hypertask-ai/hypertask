import prisma from '@/lib/prisma';
import React from 'react'

interface ItaskMentionSearch{
    projectIds:number[];
    take:number;
    searchQuery:string
}
const taskMentionSearch = async(props:ItaskMentionSearch) => {
    const {projectIds, take, searchQuery} = props
    console.log("🚀 ~ taskMentionSearch ~ props:", props)
    const searchedTasks = await prisma.task.findMany({
        take: take,
        where: {
          projectId: {
            in: projectIds,
          },
          deletedAt:null,
          
          // description:{
            //   search:searchQuery.toLowerCase()
          // },
          OR:[
            {
              title: {
              // search:searchQuery.toLowerCase(),
              contains: searchQuery.toLowerCase(), // Convert searchQuery to lowercase
              mode: 'insensitive', // Perform case-ins
              },
            },
            // {
            //   description: {
            //   // search:searchQuery.toLowerCase(),
            //   contains: param.toLowerCase(), // Convert searchQuery to lowercase
            //   mode: 'insensitive', // Perform case-ins
            //   },
            // },
            // {
              
            //   comments:{
            //     some:{
            //       text:{
            //         // search:searchQuery.toLowerCase(),
            //         contains: param.toLowerCase(), // Convert searchQuery to lowercase
            //         mode: 'insensitive', // Perform case-ins
            //       }
            //     }
            //   },
            // }
          ],
        },
        select: {
            id: true,
            projectId: true,
            title: true,
            project:{
              select:{
                title: true,
              }
            },
            uniqueIndex:true,
            description:true,
            user:true,
            archivedAt:true,
            ticketNumber:true,
            createdAt:true,
            status:true,
            updatedAt:true,
       
        },
          orderBy: {
           
            updatedAt:"desc"
            }

      });
      console.log("🚀 ~ taskMentionSearch ~ searchedTasks:", searchedTasks.map(t=>t.title))
      return searchedTasks??[]
      
}

export default taskMentionSearch