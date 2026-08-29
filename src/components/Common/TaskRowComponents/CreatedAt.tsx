import formatDateDifference from "@/utils/generateTime"

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
const CreatedAtRowElement = (
    {
        createdAt,
        className,
        futureDate
    }:{
        createdAt:Date|string;
        className?:string;
        futureDate?:boolean
    }
)=>{
    const isMbl = useContext(MobileViewContext);

    const defaultClassName = "hidden sm:block"
    return (
        <>
           
            <span
                    className={className??defaultClassName}
                    suppressHydrationWarning
                    style={{
                        color: "#8E9093",
                        fontSize: 14 }}
                    >
                    {formatDateDifference(createdAt,futureDate?futureDate:false)}
                    </span>
        </>
    )
}

export default CreatedAtRowElement