/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { StringUtils } from '../utils/string-utils';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
const { getName, getFullVersion, getCopyright, getChannel } = require('../../../../get-package-information.js');

export class ProductInformation {
    public static readonly applicationName: string = StringUtils.capitalizeFirstLetter(getName() as string);
    public static readonly applicationVersion: string = getFullVersion();
    public static readonly applicationCopyright: string = getCopyright();
    /**
     * A development build (anything not made by the release workflow, which sets apoloxChannel=release): shows a warning
     * at startup and the developer options (extra logging).
     */
    public static readonly isDevBuild: boolean = getChannel() !== 'release';
    /** Owner of the GitHub repository whose releases the update check looks at (this build: the ApoloxDragon fork). */
    public static readonly releasesOwner: string = 'ApoloxDragon';
    public static readonly releasesDownloadUrl: string = 'https://github.com/ApoloxDragon/dopamine/releases/';
}
