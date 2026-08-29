import createSugarDate from "sugar/date/create";
import { defaultHour, defaultMinutes, defaultSeconds } from "@/lib/constants/constants";

const createDateWithDefaultTime = (input:string, options_:{past:boolean, future:boolean}) => { 
  const trimmedInput = input.trim()
  const date = createSugarDate(trimmedInput,options_); // Check if the input specifies a time
  const timeSpecified = (/\b((1[0-2]|0?[1-9]):([0-5][0-9])\s?(am|pm)|([01]?[0-9]|2[0-3]):([0-5][0-9])|([01]?[0-9]|2[0-3])\s?(am|pm)|([01]?[0-9]|2[0-3]))\b/i).test(input);  
  if (!timeSpecified && date) { 
    date.setHours(defaultHour, defaultMinutes, defaultSeconds, 0)
  }; // Apply default time if no time is specified } 

  return date; 
}

export const inputChange = (input:string, options_:{past:boolean, future:boolean}) => {

  const trimmedInput = input.trim()
  if(trimmedInput.toLocaleLowerCase() === "today") return getTodayOptions(options_)
  let result2 ;
  result2=createDateWithDefaultTime(input, options_)
  const currentTime = new Date();
  var timeDifference:number;

  // Partial weekday / relative-phrase predictions (tom -> Tomorrow, w -> Wednesday)
  const phraseOptions = getPhraseOptions(input, options_)

  // Generate numeric "N units" options based on the user input
  const options = getOptions(input);

  const final = options.map(option=>{
    const display = option
    const unit = option.split(" ")[1];
    const numericValue = (options_.past ? -1 : 1) * parseInt(option.split(" ")[0]);

    // Each option is computed from a fresh "now" so they don't compound on each other.
    const d = new Date();
    switch (unit.toLowerCase()) {
        case 'months':
        case 'month':
          d.setMonth(d.getMonth() + numericValue);
          break;
        case 'weeks':
        case 'week':
          d.setDate(d.getDate() + numericValue * 7);
          break;
        case 'days':
        case 'day':
          d.setDate(d.getDate() + numericValue);
          break;
        case 'hours':
        case 'hour':
          d.setHours(d.getHours() + numericValue);
          break;
        case 'minutes':
        case 'minute':
          d.setMinutes(d.getMinutes() + numericValue);
          break;
      }

    return {display:display, date:d.toISOString()}

  }).filter(Boolean)

  if (result2.toString() !== "Invalid Date") {
    timeDifference = (result2.getTime() - currentTime.getTime()) / 1000;
    // Adjusted condition based on options.past
    if (options_.past) {
      timeDifference < 60 && final.push({ date: result2.toISOString(), display: result2.toLocaleString() });
    } else {
      timeDifference > 60 && final.push({ date: result2.toISOString(), display: result2.toLocaleString() });
    }
  }

  // Phrases first, then numeric options, then the raw Sugar catch-all; drop dups by minute.
  const seen = new Set<string>()
  return [...phraseOptions, ...final].filter((o:any) => {
    const key = o?.date ? o.date.slice(0, 16) : `d:${o?.display}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Canonical phrases we prefix-match against; the actual date is resolved by Sugar
// so past/future bias and DST are handled for us.
const DATE_PHRASES = [
  "today", "tomorrow",
  "this weekend", "next week", "next weekend", "next month", "next year",
  "end of week", "end of month",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "next monday", "next tuesday", "next wednesday", "next thursday",
  "next friday", "next saturday", "next sunday",
]

const getPhraseOptions = (value: string, options_: { past: boolean; future: boolean }) => {
  const q = value.trim().toLowerCase()
  if (q.length === 0 || /^\d/.test(q)) return []   // numeric input handled by getOptions

  const matches = DATE_PHRASES
    .map(phrase => {
      const idx = phrase.indexOf(q)
      return idx < 0 ? null : { phrase, score: idx === 0 ? 0 : 1, len: phrase.length }
    })
    .filter(Boolean)
    // prefix matches before substring; shorter phrase before longer (more likely)
    .sort((a: any, b: any) => a.score - b.score || a.len - b.len)
    .slice(0, 6)

  return matches
    .map((m: any) => {
      const d = createSugarDate(m.phrase, options_)
      if (d.toString() === "Invalid Date") return null
      // Day-level phrases (weekdays, tomorrow...) resolve to midnight; give them the
      // picker's default time like the quick-picks. Time-bearing phrases (tonight,
      // end of week) come back non-midnight and are left untouched.
      if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
        d.setHours(defaultHour, defaultMinutes, defaultSeconds, 0)
      }
      // Don't suggest an already-past date (e.g. partial "today" at 9 AM in the afternoon).
      if (options_.future && d.getTime() < Date.now()) return null
      const display = m.phrase.replace(/\b\w/g, (c: string) => c.toUpperCase())
      return { display, date: d.toISOString() }
    })
    .filter(Boolean)
}

const getTodayOptions = (options_:{past:boolean, future:boolean}) =>{
  const currentDate = new Date();
  const hour = currentDate.getHours();
  let dates: {date:string, display:string}[] = []
  
  let newHour: number = 0
  let displayHour:number = 0
  for (let index = 1; index <= 3; index++) {
    newHour = hour + index === 24 ? 0 : hour + index
    const ampm = newHour < 12 ? 'am' : 'pm'
    displayHour = newHour < 12? newHour === 0 ?  12 :  newHour : newHour === 12 ? newHour : newHour - 12
    
    let newDate = createSugarDate(newHour === 0 ? 'tomorrow at 12am':currentDate, options_)
    newDate.setHours(newHour, 0, 0, 0);
    dates.push({display: `today at ${displayHour} ${ampm}`, date: newDate.toISOString()})
    if (newHour === 0) {
      break; // Stop the loop if the hour goes past 12 AM
    }
  }
  //double check

  const lastHour = new Date(dates[dates.length-1].date).getHours()
  if(lastHour === 0) return dates
  else if(lastHour < 20) {
    let newDate = createSugarDate(currentDate, options_)
    newDate.setHours(20, 0, 0, 0); // Set to 8:00 PM
    dates.push({display: `later at 8 pm`, date: newDate.toISOString()})
  }else if(lastHour>20 && lastHour<24){
    let newDate = createSugarDate('tomorrow at 12am', options_)
    newDate.setHours(0, 0, 0, 0); // Set to 8:00 PM
    dates.push({display: `later at 12 am`, date: newDate.toISOString()})
  }

  return dates;
}


const getOptions = (value: string): string[] => {
  // Split input into words
  // console.log("🚀 ~ getOptions ~ value:", value)
  if (value.length===0) return []
  var words = value.split(/\s+/);
  
  // Filter options based on the last word of the input
  // const lastWord = words[words.length - 1];
  const firstWord = words[0];

  // Check if the first word can be translated into an integer
  const numericValue = parseInt(firstWord, 10);
  const numericString = numericValue.toString();

  // A due date "in 2 minutes" is nonsense, so only offer minutes for larger numbers;
  // hours/days/weeks/months are always offered.
  const singular = numericValue === 1
  let options = singular
    ? ["hour", "day", "week", "month"]
    : ["hours", "days", "weeks", "months"];
  if (numericValue >= 10) options.unshift("minutes")

  if (words.length===1) words.push("")
  // console.log("🚀 ~ getOptions ~ words:", words)
  if (words.length>2) {
      return []

  }

  // Check if the entire first word is a standalone numeric value
  if (firstWord !== numericString || words.length === 1) {
      return [];
  }
  // else if (words[3]?.length===0) words.push("")
  // if (words.length===2) return options.filter(option => words.some(word => option.toLowerCase().startsWith(word.toLowerCase())))
  const filteredOptions = options
  .filter(option => words.some(word => option.toLowerCase().startsWith(word.toLowerCase())))
  .map(option => words.slice(0, -1).concat(option).join(' '));

  
  return filteredOptions;
};
