import { ProductInformation } from './product-information';

/**
 * The one switch for everything that exists only in development builds (the warning at startup, developer options,
 * extra logging). Release builds (made by the release workflow, apoloxChannel=release) never turn it on, whatever the
 * settings say. Every dev-only feature must check `DevBuild.isActive`; tests may set `DevBuild.override`.
 */
export class DevBuild {
    /** For tests only. */
    public static override: boolean | undefined = undefined;

    public static get isActive(): boolean {
        return DevBuild.override ?? ProductInformation.isDevBuild;
    }
}
