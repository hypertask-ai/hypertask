"use client";
import { useAuth } from "@/hooks/General/useAuth";
import { useEffect } from "react";
import nookies from "nookies";
import LoginComponent from "../login/LoginComponent";

interface IProps {
  inviteKey: string;
  projectInvited?: string;
  project?: string;
}

const InviteComp = (props: IProps) => {
  useEffect(() => {
    if (props.project) {
      nookies.set(null, "project", props.project, {
        maxAge: 60 * 24 * 7,
        path: "/",
      });
    }
    if (props.projectInvited) {
      nookies.set(null, "projectInvite", props.projectInvited, {
        maxAge: 60 * 24 * 7,
        path: "/",
      });
    }
    nookies.set(null, "inviteKey", props.inviteKey, {
      maxAge: 60 * 24 * 7,
      path: "/",
    });
  }, []);

  return (
    <LoginComponent invite={true} />
  );
};

export default InviteComp;