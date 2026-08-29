import React, { useEffect, useState } from 'react'

const useGetDimensions = () => {
    const [screenSize, setScreenSize] = useState(getCurrentDimension());



  function getCurrentDimension(){
    return window.innerWidth 
      	 
}
    useEffect(() => {


        const updateDimension = () => {
          setScreenSize(getCurrentDimension())
        }
        window.addEventListener('resize', updateDimension);
        
        return(() => {
            window.removeEventListener('resize', updateDimension);
        })
      }, [screenSize])
    
    return { screenSize}
}

export default useGetDimensions