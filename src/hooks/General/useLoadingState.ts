import React, { useState } from 'react'

const useLoadingState = () => {
  const [loading, setLoading]  = useState(false)
  const toggleLoading = ()=> setLoading(prev=>!prev)
  return{
    loading, toggleLoading, setLoading
  }
}

export default useLoadingState