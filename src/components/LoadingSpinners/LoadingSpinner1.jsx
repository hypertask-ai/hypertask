"use client"
import React from 'react'
import styles from "@/styles/loadingspinner1.module.css"
const LoadingSpinner1 = ({ size = 80, thickness = 8, color = "#fff", className="", style=""}) => {
  return (
    <div
      className={`${styles.lds_ring} ${className ?? ''}`}
      style={{
        ...style,
        "--size": `${size}px`,
        "--thickness": `${thickness}px`,
        "--color": color,
      }}
    >
      <div></div>
      <div></div>
      <div></div>
      <div></div>
    </div>
  )
}

export default LoadingSpinner1