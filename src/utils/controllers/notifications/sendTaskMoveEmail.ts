
import { NextApiRequest, NextApiResponse } from "next";
const path = require("path");

import { sendEmail } from "@/lib/email/sendEmail";

const sendTaskMoveEmail = async(
    req:{
            senderName:string,
            taskTitle:string,
            taskLink:string,
            newSectionTitle:string,
            emailTo:string,
        
    }
) => {

    // FETCH REQUEST BODY
    const { senderName, taskTitle, taskLink,newSectionTitle, emailTo } = req;
    try {
            await sendEmail({
            to: emailTo,
            from: `${senderName} <notifications@hypertask.ai>`.trim(),
            subject: `Task: "${taskTitle}" has been moved to "${newSectionTitle}" `,
             html: `
             <html lang="tr">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="X-UA-Compatible" content="ie=edge" />
            </head>
            <body>
                <div style="font-size: 16px;">
                <p style="font-family:__Inter_08ace3, __Inter_Fallback_08ace3; " >${senderName} has moved the task: "${taskTitle}" to "${newSectionTitle}"  </p>
                <a clicktracking=off href="${taskLink}" style="font-family:__Inter_08ace3, __Inter_Fallback_08ace3;">Go To Task</a>
                
                </div>
            </body>
            </html>
             `
            })
       
        return "success" ;
        
    } catch (error) {
        console.log(error);
        return "an error occured" 
    }

}

export default sendTaskMoveEmail
