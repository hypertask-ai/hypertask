import { useEffect, useState } from "react"

type TParams = {
    defaultValue:string
}
const useInput = ({defaultValue=""}:TParams) => {
    const [input, setInput] = useState(defaultValue);
    const handleChange = (e: any) => setInput(e.target.value)

    return{
        handleChange,
        input
    }
}

export default useInput