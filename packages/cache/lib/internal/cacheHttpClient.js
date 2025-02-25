"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const http_client_1 = require("@actions/http-client");
const auth_1 = require("@actions/http-client/lib/auth");
const client_s3_1 = require("@aws-sdk/client-s3");
const lib_storage_1 = require("@aws-sdk/lib-storage");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const url_1 = require("url");
const utils = __importStar(require("./cacheUtils"));
const constants_1 = require("./constants");
const downloadUtils_1 = require("./downloadUtils");
const options_1 = require("../options");
const requestUtils_1 = require("./requestUtils");
const versionSalt = '1.0';
function getCacheApiUrl(resource) {
    const baseUrl = process.env['ACTIONS_CACHE_URL'] || '';
    if (!baseUrl) {
        throw new Error('Cache Service Url not found, unable to restore cache.');
    }
    const url = `${baseUrl}_apis/artifactcache/${resource}`;
    core.debug(`Resource Url: ${url}`);
    return url;
}
function createAcceptHeader(type, apiVersion) {
    return `${type};api-version=${apiVersion}`;
}
function getRequestOptions() {
    const requestOptions = {
        headers: {
            Accept: createAcceptHeader('application/json', '6.0-preview.1')
        }
    };
    return requestOptions;
}
function createHttpClient() {
    const token = process.env['ACTIONS_RUNTIME_TOKEN'] || '';
    const bearerCredentialHandler = new auth_1.BearerCredentialHandler(token);
    return new http_client_1.HttpClient('actions/cache', [bearerCredentialHandler], getRequestOptions());
}
function getCacheVersion(paths, compressionMethod) {
    const components = paths.concat(!compressionMethod || compressionMethod === constants_1.CompressionMethod.Gzip
        ? []
        : [compressionMethod]);
    // Add salt to cache version to support breaking changes in cache entry
    components.push(versionSalt);
    return crypto
        .createHash('sha256')
        .update(components.join('|'))
        .digest('hex');
}
exports.getCacheVersion = getCacheVersion;
function getCacheEntryS3(s3Options, s3BucketName, keys) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const primaryKey = keys[0];
        const s3client = new client_s3_1.S3Client(s3Options);
        const param = {
            Bucket: s3BucketName
        };
        const contents = [];
        let hasNext = true;
        while (hasNext) {
            const response = yield s3client.send(new client_s3_1.ListObjectsV2Command(param));
            if (!response.Contents) {
                throw new Error(`Cannot found object in bucket ${s3BucketName}`);
            }
            const found = response.Contents.find((content) => content.Key === primaryKey);
            if (found && found.LastModified) {
                return {
                    cacheKey: primaryKey,
                    creationTime: found.LastModified.toString()
                };
            }
            hasNext = (_a = response.IsTruncated) !== null && _a !== void 0 ? _a : false;
            response.Contents.map((obj) => contents.push({
                Key: obj.Key,
                LastModified: obj.LastModified
            }));
        }
        // not found in primary key, So fallback to next keys
        const notPrimaryKey = keys.slice(1);
        const found = searchRestoreKeyEntry(notPrimaryKey, contents);
        if (found != null && found.LastModified) {
            return {
                cacheKey: found.Key,
                creationTime: found.LastModified.toString()
            };
        }
        return null;
    });
}
function searchRestoreKeyEntry(notPrimaryKey, entries) {
    for (const k of notPrimaryKey) {
        const found = _searchRestoreKeyEntry(k, entries);
        if (found != null) {
            return found;
        }
    }
    return null;
}
function _searchRestoreKeyEntry(notPrimaryKey, entries) {
    var _a;
    const matchPrefix = [];
    for (const entry of entries) {
        if (entry.Key === notPrimaryKey) {
            // extractly match, Use this entry
            return entry;
        }
        if ((_a = entry.Key) === null || _a === void 0 ? void 0 : _a.startsWith(notPrimaryKey)) {
            matchPrefix.push(entry);
        }
    }
    if (matchPrefix.length === 0) {
        // not found, go to next key
        return null;
    }
    matchPrefix.sort(function (i, j) {
        var _a, _b, _c, _d, _e, _f;
        // eslint-disable-next-line eqeqeq
        if (i.LastModified == undefined || j.LastModified == undefined) {
            return 0;
        }
        if (((_a = i.LastModified) === null || _a === void 0 ? void 0 : _a.getTime()) === ((_b = j.LastModified) === null || _b === void 0 ? void 0 : _b.getTime())) {
            return 0;
        }
        if (((_c = i.LastModified) === null || _c === void 0 ? void 0 : _c.getTime()) > ((_d = j.LastModified) === null || _d === void 0 ? void 0 : _d.getTime())) {
            return -1;
        }
        if (((_e = i.LastModified) === null || _e === void 0 ? void 0 : _e.getTime()) < ((_f = j.LastModified) === null || _f === void 0 ? void 0 : _f.getTime())) {
            return 1;
        }
        return 0;
    });
    // return newest entry
    return matchPrefix[0];
}
function getCacheEntry(keys, paths, options, s3Options, s3BucketName) {
    return __awaiter(this, void 0, void 0, function* () {
        if (s3Options && s3BucketName) {
            return yield getCacheEntryS3(s3Options, s3BucketName, keys);
        }
        const httpClient = createHttpClient();
        const version = getCacheVersion(paths, options === null || options === void 0 ? void 0 : options.compressionMethod);
        const resource = `cache?keys=${encodeURIComponent(keys.join(','))}&version=${version}`;
        const response = yield requestUtils_1.retryTypedResponse('getCacheEntry', () => __awaiter(this, void 0, void 0, function* () { return httpClient.getJson(getCacheApiUrl(resource)); }));
        if (response.statusCode === 204) {
            return null;
        }
        if (!requestUtils_1.isSuccessStatusCode(response.statusCode)) {
            throw new Error(`Cache service responded with ${response.statusCode}`);
        }
        const cacheResult = response.result;
        const cacheDownloadUrl = cacheResult === null || cacheResult === void 0 ? void 0 : cacheResult.archiveLocation;
        if (!cacheDownloadUrl) {
            throw new Error('Cache not found.');
        }
        core.setSecret(cacheDownloadUrl);
        core.debug(`Cache Result:`);
        core.debug(JSON.stringify(cacheResult));
        return cacheResult;
    });
}
exports.getCacheEntry = getCacheEntry;
function downloadCache(cacheEntry, archivePath, options, s3Options, s3BucketName) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const archiveLocation = (_a = cacheEntry.archiveLocation) !== null && _a !== void 0 ? _a : 'https://example.com'; // for dummy
        const archiveUrl = new url_1.URL(archiveLocation);
        const downloadOptions = options_1.getDownloadOptions(options);
        if (downloadOptions.useAzureSdk &&
            archiveUrl.hostname.endsWith('.blob.core.windows.net')) {
            // Use Azure storage SDK to download caches hosted on Azure to improve speed and reliability.
            yield downloadUtils_1.downloadCacheStorageSDK(archiveLocation, archivePath, downloadOptions);
        }
        else if (s3Options && s3BucketName && cacheEntry.cacheKey) {
            yield downloadUtils_1.downloadCacheStorageS3(cacheEntry.cacheKey, archivePath, s3Options, s3BucketName);
        }
        else {
            // Otherwise, download using the Actions http-client.
            yield downloadUtils_1.downloadCacheHttpClient(archiveLocation, archivePath);
        }
    });
}
exports.downloadCache = downloadCache;
// Reserve Cache
function reserveCache(key, paths, options, s3Options, s3BucketName) {
    return __awaiter(this, void 0, void 0, function* () {
        if (s3Options && s3BucketName) {
            return {
                statusCode: 200,
                result: null,
                headers: {}
            };
        }
        const httpClient = createHttpClient();
        const version = getCacheVersion(paths, options === null || options === void 0 ? void 0 : options.compressionMethod);
        const reserveCacheRequest = {
            key,
            version,
            cacheSize: options === null || options === void 0 ? void 0 : options.cacheSize
        };
        const response = yield requestUtils_1.retryTypedResponse('reserveCache', () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.postJson(getCacheApiUrl('caches'), reserveCacheRequest);
        }));
        return response;
    });
}
exports.reserveCache = reserveCache;
function getContentRange(start, end) {
    // Format: `bytes start-end/filesize
    // start and end are inclusive
    // filesize can be *
    // For a 200 byte chunk starting at byte 0:
    // Content-Range: bytes 0-199/*
    return `bytes ${start}-${end}/*`;
}
function uploadChunk(httpClient, resourceUrl, openStream, start, end) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`Uploading chunk of size ${end -
            start +
            1} bytes at offset ${start} with content range: ${getContentRange(start, end)}`);
        const additionalHeaders = {
            'Content-Type': 'application/octet-stream',
            'Content-Range': getContentRange(start, end)
        };
        const uploadChunkResponse = yield requestUtils_1.retryHttpClientResponse(`uploadChunk (start: ${start}, end: ${end})`, () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.sendStream('PATCH', resourceUrl, openStream(), additionalHeaders);
        }));
        if (!requestUtils_1.isSuccessStatusCode(uploadChunkResponse.message.statusCode)) {
            throw new Error(`Cache service responded with ${uploadChunkResponse.message.statusCode} during upload chunk.`);
        }
    });
}
function uploadFileS3(s3options, s3BucketName, archivePath, key, concurrency, maxChunkSize) {
    return __awaiter(this, void 0, void 0, function* () {
        core.debug(`Start upload to S3 (bucket: ${s3BucketName})`);
        const fileStream = fs.createReadStream(archivePath);
        try {
            const parallelUpload = new lib_storage_1.Upload({
                client: new client_s3_1.S3Client(s3options),
                queueSize: concurrency,
                partSize: maxChunkSize,
                params: {
                    Bucket: s3BucketName,
                    Key: key,
                    Body: fileStream
                }
            });
            parallelUpload.on('httpUploadProgress', (progress) => {
                core.debug(`Uploading chunk progress: ${JSON.stringify(progress)}`);
            });
            yield parallelUpload.done();
        }
        catch (error) {
            throw new Error(`Cache upload failed because ${error}`);
        }
        return;
    });
}
function uploadFile(httpClient, cacheId, archivePath, key, options, s3options, s3BucketName) {
    return __awaiter(this, void 0, void 0, function* () {
        // Upload Chunks
        const uploadOptions = options_1.getUploadOptions(options);
        const concurrency = utils.assertDefined('uploadConcurrency', uploadOptions.uploadConcurrency);
        const maxChunkSize = utils.assertDefined('uploadChunkSize', uploadOptions.uploadChunkSize);
        const parallelUploads = [...new Array(concurrency).keys()];
        core.debug('Awaiting all uploads');
        let offset = 0;
        if (s3options && s3BucketName) {
            yield uploadFileS3(s3options, s3BucketName, archivePath, key, concurrency, maxChunkSize);
            return;
        }
        const fileSize = utils.getArchiveFileSizeInBytes(archivePath);
        const resourceUrl = getCacheApiUrl(`caches/${cacheId.toString()}`);
        const fd = fs.openSync(archivePath, 'r');
        try {
            yield Promise.all(parallelUploads.map(() => __awaiter(this, void 0, void 0, function* () {
                while (offset < fileSize) {
                    const chunkSize = Math.min(fileSize - offset, maxChunkSize);
                    const start = offset;
                    const end = offset + chunkSize - 1;
                    offset += maxChunkSize;
                    yield uploadChunk(httpClient, resourceUrl, () => fs
                        .createReadStream(archivePath, {
                        fd,
                        start,
                        end,
                        autoClose: false
                    })
                        .on('error', error => {
                        throw new Error(`Cache upload failed because file read failed with ${error.message}`);
                    }), start, end);
                }
            })));
        }
        finally {
            fs.closeSync(fd);
        }
        return;
    });
}
function commitCache(httpClient, cacheId, filesize) {
    return __awaiter(this, void 0, void 0, function* () {
        const commitCacheRequest = { size: filesize };
        return yield requestUtils_1.retryTypedResponse('commitCache', () => __awaiter(this, void 0, void 0, function* () {
            return httpClient.postJson(getCacheApiUrl(`caches/${cacheId.toString()}`), commitCacheRequest);
        }));
    });
}
function saveCache(cacheId, archivePath, key, options, s3Options, s3BucketName) {
    return __awaiter(this, void 0, void 0, function* () {
        const httpClient = createHttpClient();
        core.debug('Upload cache');
        yield uploadFile(httpClient, cacheId, archivePath, key, options, s3Options, s3BucketName);
        // Commit Cache
        core.debug('Commiting cache');
        const cacheSize = utils.getArchiveFileSizeInBytes(archivePath);
        core.info(`Cache Size: ~${Math.round(cacheSize / (1024 * 1024))} MB (${cacheSize} B)`);
        if (!s3Options) {
            // already commit on S3
            const commitCacheResponse = yield commitCache(httpClient, cacheId, cacheSize);
            if (!requestUtils_1.isSuccessStatusCode(commitCacheResponse.statusCode)) {
                throw new Error(`Cache service responded with ${commitCacheResponse.statusCode} during commit cache.`);
            }
        }
        core.info('Cache saved successfully');
    });
}
exports.saveCache = saveCache;
//# sourceMappingURL=cacheHttpClient.js.map