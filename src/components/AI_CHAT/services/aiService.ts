export const generateAIResponse = (userInput: string): Promise<string> => {
    return new Promise((resolve) => {
      // Simulate AI response after a delay
      setTimeout(() => {
        let response = ""
        
        // Generate contextual responses based on user input
        const lowercaseInput = userInput.toLowerCase()
        if (lowercaseInput.includes("hello") || lowercaseInput.includes("hi")) {
          response = "Hello! How can I help you with your tasks today?"
        } else if (lowercaseInput.includes("task") || lowercaseInput.includes("create")) {
          response = "I can help you create and manage tasks. Would you like me to create a new task for you?"
        } else if (lowercaseInput.includes("filter") || lowercaseInput.includes("sort")) {
          response = "I can filter and sort your board based on various criteria. What specific filtering do you need?"
        } else if (lowercaseInput.includes("idea") || lowercaseInput.includes("brain")) {
          response = "Let's brainstorm some ideas! What topic are you working on?"
        } else if (lowercaseInput.includes("research")) {
          response = "I can conduct deep research on topics related to your tasks. What would you like me to research?"
        } else {
          response =
            "I'm here to help with your tasks. I can create and move tasks, filter and sort your board, help brainstorm ideas, or conduct deep research. What would you like assistance with?"
        }
        
        resolve(response)
      }, 1500)
    })
  }