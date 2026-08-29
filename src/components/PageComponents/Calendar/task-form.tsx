// "use client"

// import type React from "react"

// import { useState } from "react"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Button } from "@/components/ui/button"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// import { Textarea } from "@/components/ui/textarea"

// type Task = {
//   id: string
//   title: string
//   description?: string
//   due_date: string
//   status: string
//   priority: string
//   color: string
// }

// interface TaskFormProps {
//   onAddTask: (task: Omit<Task, "id">) => void
// }

// export function TaskForm({ onAddTask }: TaskFormProps) {
//   const [title, setTitle] = useState("")
//   const [description, setDescription] = useState("")
//   const [dueDate, setDueDate] = useState("")
//   const [priority, setPriority] = useState("medium")
//   const [color, setColor] = useState("blue")
//   const [isLoading, setIsLoading] = useState(false)

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     if (!title || !dueDate) return

//     setIsLoading(true)
//     try {
//       onAddTask({
//         title,
//         description: description || undefined,
//         due_date: dueDate,
//         status: "todo",
//         priority,
//         color,
//       })
//       setTitle("")
//       setDescription("")
//       setDueDate("")
//       setPriority("medium")
//       setColor("blue")
//     } finally {
//       setIsLoading(false)
//     }
//   }

//   return (
//     <Card className="bg-card border border-border sticky top-6">
//       <CardHeader>
//         <CardTitle className="text-subheading">Add Task</CardTitle>
//       </CardHeader>
//       <CardContent>
//         <form onSubmit={handleSubmit} className="space-y-4">
//           <div className="space-y-2">
//             <Label htmlFor="title">Title</Label>
//             <Input
//               id="title"
//               placeholder="Task title..."
//               value={title}
//               onChange={(e) => setTitle(e.target.value)}
//               required
//             />
//           </div>

//           <div className="space-y-2">
//             <Label htmlFor="description">Description</Label>
//             <Textarea
//               id="description"
//               placeholder="Task description..."
//               value={description}
//               onChange={(e) => setDescription(e.target.value)}
//               className="resize-none h-20"
//             />
//           </div>

//           <div className="space-y-2">
//             <Label htmlFor="due-date">Due Date</Label>
//             <Input id="due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
//           </div>

//           <div className="space-y-2">
//             <Label htmlFor="priority">Priority</Label>
//             <Select value={priority} onValueChange={setPriority}>
//               <SelectTrigger id="priority">
//                 <SelectValue />
//               </SelectTrigger>
//               <SelectContent>
//                 <SelectItem value="low">Low</SelectItem>
//                 <SelectItem value="medium">Medium</SelectItem>
//                 <SelectItem value="high">High</SelectItem>
//               </SelectContent>
//             </Select>
//           </div>

//           <div className="space-y-2">
//             <Label htmlFor="color">Color</Label>
//             <Select value={color} onValueChange={setColor}>
//               <SelectTrigger id="color">
//                 <SelectValue />
//               </SelectTrigger>
//               <SelectContent>
//                 <SelectItem value="blue">Blue</SelectItem>
//                 <SelectItem value="purple">Purple</SelectItem>
//                 <SelectItem value="pink">Pink</SelectItem>
//                 <SelectItem value="green">Green</SelectItem>
//                 <SelectItem value="orange">Orange</SelectItem>
//               </SelectContent>
//             </Select>
//           </div>

//           <Button type="submit" className="w-full" disabled={isLoading}>
//             {isLoading ? "Adding..." : "Add Task"}
//           </Button>
//         </form>
//       </CardContent>
//     </Card>
//   )
// }
