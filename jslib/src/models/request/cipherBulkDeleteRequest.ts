export class CipherBulkDeleteRequest {
    ids: string[];

    constructor(ids: string[]) {
        this.ids = ids == null ? [] : ids;
    }
}
