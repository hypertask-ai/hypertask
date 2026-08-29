import { FC, useState } from "react";

interface IProps{
    title:string;
    callback:(key:any, input:string) =>any;
    id:string;
    placeHolder:string;
}
const InputWithLabel:FC<IProps> = ({title, callback, placeHolder, id}) => {
  const [value, setValue] = useState("")


  const onChange = (e:any)=>{
    setValue(e.target.value)
    callback(id, e.target.value)
  }
  return (
    <div className='flex flex-col gap-1 '>
        <span>
            {title}
        </span>
        <input className='bg-active-list-element outline-none p-2 font-normal text-white-black rounded border-thin border-border-light-gray-thin' key={id} onChange={onChange} value={value} placeholder={placeHolder} />
    </div>
  )
}

export default InputWithLabel