const convertToPlain=(html)=>{
    var tempDivElement = document.createElement("div");

    tempDivElement.innerHTML = html;

    return tempDivElement.textContent || tempDivElement.innerText || "";
}
export default convertToPlain