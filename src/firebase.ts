"use client"
import { initializeApp, getApps, getApp } from "firebase/app";

export const firebaseConfig = {

  apiKey: "AIzaSyD1YIaE-4HHzsjRpRYe2rJyeTPMbSENnQc", // trufflehog:ignore

  authDomain: "auth.hypertask.ai",

  projectId: "hypertasks-403606",

  storageBucket: "hypertasks-403606.appspot.com",

  messagingSenderId: "992767949049",

  appId: "1:992767949049:web:104858eb42536da2f94a28",

  measurementId: "G-WT9Y8VS5P8"

};


export const app = !getApps.length ? initializeApp(firebaseConfig) : getApp();
