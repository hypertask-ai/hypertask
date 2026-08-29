import { ReactNode } from "react"

interface IProps{
    children?:ReactNode,
    sectionTitle:string
}
const SectionWrapper:React.FC<IProps> = ({children,sectionTitle})=>{

    return (
        <div className="flex flex-col gap-3">
            {/* ======= title ========= */}
            <h2 className="text-content font-semibold uppercase tracking-wider text-text-light-gray">
                {sectionTitle}
            </h2>

            {/* ======= section content ========= */}
            <div className="flex font-normal flex-col gap-[10px]">
            {children}
            </div>
        </div>
    )
}

export default SectionWrapper
