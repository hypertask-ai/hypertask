  
function generateRandomNumberBetween(min: number, max: number, decimalPlaces: number = 15): number {
    if (decimalPlaces < 0 || decimalPlaces > 15) {
        throw new Error("Decimal places must be between 0 and 15.");
    }
    var rand = Math.random()*(max-min) + min;
    var power = Math.pow(15, decimalPlaces);

    return Math.floor(rand*power) / power;
}

function generateRank(prevRank: string | undefined, nextRank: string | undefined) {
    const uptoDecimals = 15
    const padStartValue = 20
    if (prevRank ===undefined&& nextRank===undefined){
        return "A0100"
    }

    if (!prevRank &&nextRank) {
        let nextNumericPart = parseFloat(nextRank.replace(/[a-zA-Z]/g, ""));
        let newNumericPart = generateRandomNumberBetween(0, nextNumericPart)
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');

        return nextRank.replace(/[0-9.]+$/, formattedNewNumericPart)
        
    }

    if (!nextRank &&prevRank )  {
        let prevNumericPart = parseFloat(prevRank.replace(/[a-zA-Z]/g, ""));
        let newNumericPart = prevNumericPart+90
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');

        return prevRank.replace(/[0-9.]+$/, formattedNewNumericPart)
    }
    if(prevRank===nextRank){
        return "A0050"
    }
    

    if(prevRank && nextRank){
        const prevNumericPart = parseFloat(prevRank.replace(/[a-zA-Z]/g, ""));
        const nextNumericPart = parseFloat(nextRank.replace(/[a-zA-Z]/g, ""));
        

        let newNumericPart=generateRandomNumberBetween(prevNumericPart,nextNumericPart)
    
        const formattedNewNumericPart = newNumericPart.toFixed(uptoDecimals).padStart(padStartValue, '0');
        let newRank = prevRank.replace(/[0-9.]+$/,formattedNewNumericPart);
                
    
        return newRank;
    }
  
}

export default generateRank;
