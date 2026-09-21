import { sendEmail } from "@/lib/email/sendEmail";

const sendInviteEmail = async (emails, link, projectName, by) => {
  console.log(
    "🤔 ~ sendInviteEmail ~ emails, link, projectName, by:",
    emails,
    link,
    projectName,
    by
  );

  try {
    const res = await sendEmail({
      to: emails,
      from: `${by} <notifications@hypertask.ai>`.trim(),
      subject: `${by} has invited you to the Kanban Board  '"${projectName}"'`,
      html: `
            <html lang="tr">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
                    <title>Email Invite</title>
                    <style>
    
                    </style>
                </head>
                <body style="color:black;">
                    <div style="padding:20px 0px;">
                    <div style="font-size:16px;margin-bottom: 20px;font-family:__Inter_08ace3, __Inter_Fallback_08ace3; color:black">
                        <p style="margin-bottom:20px;">
                        ${by} has invited you to the kanban board ${projectName} in Hypertask
                        </p>
    
                        <p>
                        Open this link to sign in now: <a clicktracking=off style="width: fit-content;font-size: 16px; margin: auto; font-family:__Inter_08ace3, __Inter_Fallback_08ace3;  text-decoration: none;" href="${link}"> ${link}</a> 
    
                        </p>
    
    
                    </div>
                    <div style="font-size:16px;margin-top:10px;font-family:__Inter_08ace3, __Inter_Fallback_08ace3; color:black">
                        <a clicktracking=off style="width: fit-content;font-size: 16px; margin-bottom:20px; font-family:__Inter_08ace3, __Inter_Fallback_08ace3;  text-decoration: none;" href="https://app.hypertask.ai">Hypertask.ai</a> is a super fast kanban board for communication and collaboration
                        <p style="font-size: 16px; margin-top:10px;">Hypertask Lab Ltd.</p>
    
                    </div>
    
                    
                    </div>
                </body>
                </html>
             `,
    });
    console.log("🤔 ~ sendInviteEmail ~ res:", res);

    return {
      status: 200,
      message: "success",
    };
  } catch (error) {
    console.log("🤔 ~ sendInviteEmail ~ error:", error);

    return {
      status: 500,
      message: error,
    };
  }
};

export default sendInviteEmail;
