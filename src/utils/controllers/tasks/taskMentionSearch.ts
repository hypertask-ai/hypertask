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
          
          OR:[
            {
              title: {
              contains: searchQuery.toLowerCase(),
              mode: 'insensitive',
              },
            },
              
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