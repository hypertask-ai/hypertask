

import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { IUser } from "@/models/model";


const membersGetAll = async (projectId:string|string[], user:IUser,teamMembers?:any, teamId_?:string|string[]) => {
        try {
            const projectIdNum = parseInt(projectId as string);
            const members = await prisma.member.findMany({
                where: {
                    projectId: projectIdNum,
                    agentId: null,
                },
                include: {
                    user: true,
                }
            })
            const boardAgentMembers = await prisma.member.findMany({
                where: {
                    projectId: projectIdNum,
                    agentId: { not: null },
                    agent: { revokedAt: null, archivedAt: null },
                },
                include: {
                    agent: { select: publicAgentSelect },
                    user: true,
                },
            })
            const boardAgents = boardAgentMembers
                .filter((m) => m.agent != null)
                .map((m) => m.agent!)
            console.log("🚀 ~ membersGetAll ~ members:", members)
            let team_members:any[]=[];
            const invites = await prisma.invite.findMany({
                where:{
                    projectId:parseInt(projectId as string),
                    expired:false,

                },
                
                orderBy:{
                    invitedAt:"desc"
                },

                
                
            })
            // ============== all team members EXCEPT the above if teamMembers is given. 
            if (teamMembers && teamId_){
                const team = await prisma.team.findUnique({where:{id:teamId_ as string}, include:{
                    googleAccount:true
                }})
                const project = await prisma.project.findUnique({where:{
                    id: parseInt(projectId as string),
                }})
                console.log("🚀 ~ membersGetAll ~ project:", project)
                // ========= fetch owner of the team too 
                const teamOwner = await prisma.user.findUnique({where:{id:team?.googleAccount.userId}})
                console.log("🚀 ~ membersGetAll ~ teamOwner:", teamOwner)
                
                
                team_members = await prisma.member_Team.findMany({
                    where:{
                        teamId:teamId_ as string,
                        AND:[
                            {
                                userId:{
                                    notIn:members.map(m=>m.userId)
                                }

                            },
                            {
                                userId:{not:project?.ownerId}
                            },
                            {
                                userId:{not:user.id}
                            },
                            {
                                user:{
                                    email:{notIn:invites.flatMap(i=>i.emails)}
                                }
                            },
                            {
                                
                            }
                        ]
                    },
                    include:{
                        user:true,
                    },
                })
                console.log("🚀 ~ membersGetAll ~ team_members:", team_members)

                // =========== requester is not the owner himself. 
                // =========== team
                console.log("🚀 ~ membersGetAll ~ project?.ownerId!==teamOwner.id:", project?.ownerId)
                if (teamOwner&&teamOwner?.id !== user.id && !members.map(m=>m.userId).includes(teamOwner?.id) && project?.ownerId!==teamOwner.id ) {
                    team_members.push({ id: -1, user: teamOwner });
                    console.log("🚀 ~ membersGetAll ~ team_members:", team_members)
                   }

            }

          
            // console.log("🚀 ~ file: getAll.ts:22 ~ membersGetAll ~ invites:", invites)

            // Extract unique email addresses from invites
// Extract unique email addresses from all invites
// Provide an initial type for the emails array
const allEmails: string[] = invites.reduce<string[]>((emails, invite) => {
    invite.emails.forEach((email) => {
      if (!emails.includes(email)) {
        emails.push(email);
      }
    });
    return emails;
  }, []);
  console.log("🚀 ~ file: getAll.ts:42 ~ membersGetAll ~ allEmails:", allEmails)
  
  // Filter out emails that match members by email
  const finalUniqueEmails = allEmails.filter((email) => {
    const isEmailInMembers = members.some(
      (member) => member.user.email === email
    );
    return !isEmailInMembers;
  });
    
    console.log("🚀 ~ file: getAll.ts:34 ~ membersGetAll ~ uniqueEmails:", finalUniqueEmails)

            return({
                status:200,
                json:{
                    members:members,
                    boardAgents,
                    emailsInvited:finalUniqueEmails,
                    teamMembers:team_members
                }
            })
            // return res.status(200).json(members);
        } catch (error) {
            console.log(error);
            return({
                status:500,
                error:error
            })
            // res.status(200).json([]);
        }

};

export default membersGetAll;
