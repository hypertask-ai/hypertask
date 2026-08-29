function sortByStringParam<T>(array: T[], param: keyof T): T[] {
    array.sort((a, b) => {
        const paramA = a[param];
        const paramB = b[param];

        if (paramA < paramB) {
            return -1;
        }
        if (paramA > paramB) {
            return 1;
        }
        return 0;
    });

    return array
}

export default sortByStringParam