import { PropsWithChildren } from "react";

interface IHeader{
    title:string
}
export const OnboardingHeader:React.FC<IHeader> = ({title})=>{

    return (
        <h1 className="text-heading sm:text-4xl font-bold">{title}</h1>
    )
}
