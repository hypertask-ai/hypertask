structure is as:
- page.tsx

-- TrashComp.

--- <<<<<PageContainer>>>
---     <<<<<TrashContextProvider>>> 
---         <<<<<ProjectContainer>>>
---     <<<<<TrashContextProvider>>>
--- <<<<<PageContainer>>>

---- the provider provides context for actions such as selected index, keyboard functions, handle mouse movements. 
---- The provider will pave path for faster deployment of Keyboard + Mouse movement boilerplate 
---- instead of prop drilling, context API has been used.

=========== PROJECT CONTAINER
=> contains TaskRow Component. 
++ TaskRow component has all the TaskRowComponent elements such as TaskTitle, CreatedAt etc.
