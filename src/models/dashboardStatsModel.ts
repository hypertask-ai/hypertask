export  interface IProjectMonthly { 
    month: string, 
    project_count: any 
  }
  
  
export interface IProjectWeekly { 
    week: string, 
    year:string,
    project_count: any 
  }

export interface IProjectDaily { 
    day: string, 
    project_count: any 
}


export interface ICommentMonthly { 
    month: string, 
    comment_count: any 
}


export interface ICommentWeekly { 
    week: string, 
    year:string,

    comment_count: any 
}


export interface ICommentDaily { 
    day: string, 
    comment_count: any 
}


export interface ITaskMonthly { 
    month: string, 
    task_count: any 
}


export interface ITaskWeekly { 
    week: string, 
    year:string,
    task_count: any 
}


export interface ITaskDaily { 
    day: string, 
    task_count: any 
}


