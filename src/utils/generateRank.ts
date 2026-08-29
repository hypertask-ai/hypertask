  
function generateRandomNumberBetween(min: number, max: number, decimalPlaces: number = 15): number {
    if (decimalPlaces < 0 || decimalPlaces > 15) {
        throw new Error("Decimal places must be between 0 and 15.");
    }
    var rand = Math.random()*(max-min) + min;
    var power = Math.pow(15, decimalPlaces);

    return Math.floor(rand*power) / power;
}

function generateRank(prevRank: string | undefined, nextRank: string | undefined) {
    // function incrementRank(rank: string, increment: number) {
    //     const numericPart = parseFloat(rank.replace(/[a-zA-Z]/g, ""));
    //     return rank.replace(/[0-9.]+$/, (numericPart + increment).toFixed(20));
    // }
    
    const uptoDecimals = 15
    const padStartValue = 20
    // empty section
    if (prevRank ===undefined&& nextRank===undefined){
        return "A0100"
    }

    // top of section
    if (!prevRank &&nextRank) {
        let nextNumericPart = parseFloat(nextRank.replace(/[a-zA-Z]/g, ""));
        let newNumericPart = generateRandomNumberBetween(0, nextNumericPart)
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');

        return nextRank.replace(/[0-9.]+$/, formattedNewNumericPart)
        
    }

    // bottom of section
    if (!nextRank &&prevRank )  {
        let prevNumericPart = parseFloat(prevRank.replace(/[a-zA-Z]/g, ""));
        let newNumericPart = prevNumericPart+90
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');

        return prevRank.replace(/[0-9.]+$/, formattedNewNumericPart)

        // return incrementRank(prevRank, 0.01);
    }
    if(prevRank===nextRank){
        return "A0050"
    }
    

    // between two tasks
    if(prevRank && nextRank){
        const prevNumericPart = parseFloat(prevRank.replace(/[a-zA-Z]/g, ""));
        const nextNumericPart = parseFloat(nextRank.replace(/[a-zA-Z]/g, ""));
        
        // let newNumericPart = (prevNumericPart + nextNumericPart) / 2;
        // console.log("🚀 ~ file: generateRank.ts:21 ~ generateRank ~ newNumericPart:", newNumericPart)

        let newNumericPart=generateRandomNumberBetween(prevNumericPart,nextNumericPart)
    
        // Ensure the new numeric part falls between the two ranks and is different from both
        // while (newNumericPart == prevNumericPart || newNumericPart == nextNumericPart) {
        //     newNumericPart += 0.05; 
        //     console.log("🚀 ~ file: generateRank.ts:26 ~ generateRank ~ newNumericPart:", newNumericPart)
        // }
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');
        let newRank = prevRank.replace(/[0-9.]+$/,formattedNewNumericPart);
                
        // Check if the new rank is equal to prevRank or nextRank, and if so, add a small increment
        // if (newRank === prevRank || newRank === nextRank) {
        //     return generateRank(prevRank,newRank);
        // }
    
        return newRank;
    }
  
}

export default generateRank;
