"use client"
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";

// Your web app's Firebase configuration

//dev
// const firebaseConfig = {
//   apiKey: "AIzaSyCQ7FqrJK8MtjhWuYfn1_VDg3gyP0vIX5o",
//   authDomain: "hypertasks-dev.firebaseapp.com",
//   projectId: "hypertasks-dev",
//   storageBucket: "hypertasks-dev.appspot.com",
//   messagingSenderId: "990051762057",
//   appId: "1:990051762057:web:c81b403eeaf44fb086ab58",
//   measurementId: "G-7EVGXB8DVC"
// };

//prod
export const firebaseConfig = {

  apiKey: "AIzaSyD1YIaE-4HHzsjRpRYe2rJyeTPMbSENnQc",

  authDomain: "auth.hypertask.ai",

  projectId: "hypertasks-403606",

  storageBucket: "hypertasks-403606.appspot.com",

  messagingSenderId: "992767949049",

  appId: "1:992767949049:web:104858eb42536da2f94a28",

  measurementId: "G-WT9Y8VS5P8"

};


// google client id:992767949049-3ql6a7cep39truv47o2u50ktmi5k2053.apps.googleusercontent.com
// Initialize Firebase
export const app = !getApps.length ? initializeApp(firebaseConfig) : getApp();
