export class InputData {
    public constructor(
        public dialogTitle: string,
        public inputText: string,
        public placeHolderText: string,
        public invalidCharacters: string[],
        /** Optional text above the field that says what to type. */
        public description: string = '',
        /** Optional icon for the header (default: a question mark). */
        public icon: string = 'las la-question',
    ) {}
}
