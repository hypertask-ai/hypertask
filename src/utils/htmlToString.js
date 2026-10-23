const convertToPlain=(html)=>{
    const tempDivElement = new window.DOMParser().parseFromString(html, "text/html").body;

    return tempDivElement.textContent || tempDivElement.innerText || "";
}
export default convertToPlain