/* eslint-disable no-restricted-syntax */
import { TsGoogleDrive } from 'ts-google-drive';
import path from 'path';
import fs from 'fs';

export default class CloudFileManager {
  public cloudPool: TsGoogleDrive[];

  constructor() {
    this.cloudPool = [];
    for (let i = 0; i < Number(process.env.GDRIVE_CLOUD_POOL_SIZE); i++) {
      if (
        process.env[`GDRIVE_CLOUD_CLIENT_EMAIL_${i}`] &&
        process.env[`GDRIVE_CLOUD_PRIVATE_KEY_${i}`]
      ) {
        this.cloudPool.push(
          new TsGoogleDrive({
            credentials: {
              client_email: process.env[`GDRIVE_CLOUD_CLIENT_EMAIL_${i}`],
              private_key: String(
                process.env[`GDRIVE_CLOUD_PRIVATE_KEY_${i}`],
              ).replace(/\\n/g, '\n'),
            },
          }),
        );
      }
    }
  }

  public static getCloudPool(): TsGoogleDrive[] {
    const cloudPool: TsGoogleDrive[] = [];

    for (let i = 1; i <= Number(process.env.GDRIVE_CLOUD_POOL_SIZE); i++) {
      if (
        process.env[`GDRIVE_CLOUD_CLIENT_EMAIL_${i}`] &&
        process.env[`GDRIVE_CLOUD_PRIVATE_KEY_${i}`]
      ) {
        cloudPool.push(
          new TsGoogleDrive({
            credentials: {
              client_email: process.env[`GDRIVE_CLOUD_CLIENT_EMAIL_${i}`],
              private_key: String(
                process.env[`GDRIVE_CLOUD_PRIVATE_KEY_${i}`],
              ).replace(/\\n/g, '\n'),
            },
          }),
        );
      }
    }
    return cloudPool;
  }

  public static async getFolderId(
    cloud: TsGoogleDrive,
    folderName: string,
  ): Promise<string | undefined> {
    const query = cloud.query().setFolderOnly().setNameEqual(folderName);
    if (query.hasNextPage()) {
      const files = await query.run();
      if (files.length > 0) return files.length > 0 ? files[0].id : undefined;
    }
    return undefined;
  }

  public static async downloadFileCloudPool(
    pathFile: string,
    remoteFolderName: string,
  ): Promise<boolean> {
    const cloudPool = CloudFileManager.getCloudPool();
    for await (const cloud of cloudPool) {
      const remoteFolderId = await CloudFileManager.getFolderId(
        cloud,
        remoteFolderName,
      );
      if (remoteFolderId) {
        const fileExists = await CloudFileManager.fileExistsInCloudPool(
          pathFile,
          remoteFolderName,
        );
        if (fileExists) {
          const file = await fileExists.cloud.getFile(fileExists.fileId);
          if (file) {
            fs.writeFileSync(pathFile, await file.download());
            return true;
          }
        }
      }
    }
    return false;
  }

  public async downloadFileCloudPool(
    pathFile: string,
    remoteFolderName: string,
  ): Promise<boolean> {
    return CloudFileManager.downloadFileCloudPool(pathFile, remoteFolderName);
  }

  public static async downloadFileCloud(
    cloud: TsGoogleDrive,
    pathFile: string,
    remoteFolderId: string,
  ): Promise<boolean> {
    const remoteFolder = await cloud.getFile(remoteFolderId);
    if (!remoteFolder)
      throw new Error(
        `Download file from cloud failed - Remote folder Id not found: ${remoteFolderId}`,
      );

    const query = cloud
      .query()
      .setFileOnly()
      .inFolder(remoteFolderId)
      .setNameEqual(path.basename(pathFile));

    if (query.hasNextPage()) {
      const files = await query.run();
      if (!files || files.length === 0) return false;

      let found;
      for await (const file of files) {
        if (
          file.parents[0] === remoteFolderId &&
          file.name === path.basename(pathFile)
        )
          found = file;
        break;
      }
      if (!found) return false;

      fs.writeFileSync(pathFile, await found.download());
      return true;
    }
    return false;
  }

  public static async uploadFileCloudPool(
    pathFile: string,
    remoteFolderName: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    let fileExists:
      | {
          cloud: TsGoogleDrive;
          fileId: string;
        }
      | undefined = await CloudFileManager.fileExistsInCloudPool(
      pathFile,
      remoteFolderName,
    );

    if (deleteIfExists) {
      if (fileExists) {
        const file = await fileExists.cloud.getFile(fileExists.fileId);
        if (file) {
          await file.delete();
          fileExists = undefined; // File no longer exists
        }
      }
    }

    if (!!fileExists && !uploadIfExists) return;

    const cloudPool: TsGoogleDrive[] = CloudFileManager.getCloudPool();
    const cloud: TsGoogleDrive = cloudPool[cloudPool.length - 1];
    const remoteFolderId = await CloudFileManager.getFolderId(
      cloud,
      remoteFolderName,
    );

    if (!remoteFolderId)
      throw new Error(
        `uploadFileCloudPool() - RemoteFolder: ${remoteFolderName} not found`,
      );

    await CloudFileManager.uploadFileCloud(
      cloud,
      pathFile,
      remoteFolderId,
      deleteIfExists,
      uploadIfExists,
    );
  }

  public async uploadFileCloudPool(
    pathFile: string,
    remoteFolderName: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    return CloudFileManager.uploadFileCloudPool(
      pathFile,
      remoteFolderName,
      deleteIfExists,
      uploadIfExists,
    );
  }

  public static async uploadFileCloud(
    gdrive: TsGoogleDrive,
    pathFile: string,
    remoteFolderId: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    let found = false;
    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolderId)
      .setNameEqual(path.basename(pathFile));
    while (query.hasNextPage()) {
      const files = await query.run();

      for await (const file of files) {
        if (deleteIfExists) await file.delete();
        else found = true;
      }
    }

    if (!found || uploadIfExists || deleteIfExists) {
      let uploaded = false;
      try {
        await gdrive.upload(pathFile, {
          parent: remoteFolderId,
        });
        uploaded = true;
      } finally {
        if (!uploaded) {
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(
            `uploadFileCloud() - Unable to upload file ${path.basename(
              pathFile,
            )} to cloud`,
          );
        }
      }
    }
  }

  public async uploadFileCloud(
    pathFile: string,
    remoteFolderId: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    return CloudFileManager.uploadFileCloud(
      this.cloudPool[this.cloudPool.length - 1],
      pathFile,
      remoteFolderId,
      deleteIfExists,
      uploadIfExists,
    );
  }

  public static async fileExistsInCloudPool(
    filename: string,
    remoteFolderName: string,
  ): Promise<{ cloud: TsGoogleDrive; fileId: string } | undefined> {
    const cloudPool: TsGoogleDrive[] = CloudFileManager.getCloudPool();
    for await (const cloud of cloudPool) {
      const remoteFolderId = await CloudFileManager.getFolderId(
        cloud,
        remoteFolderName,
      );
      if (remoteFolderId) {
        const fileId = await CloudFileManager.fileExistsInCloud(
          cloud,
          filename,
          remoteFolderId,
        );
        if (fileId) return { cloud, fileId };
      }
    }
    return undefined;
  }

  public async fileExistsInCloudPool(
    filename: string,
    remoteFolderName: string,
  ): Promise<{ cloud: TsGoogleDrive; fileId: string } | undefined> {
    return CloudFileManager.fileExistsInCloudPool(filename, remoteFolderName);
  }

  public static async fileExistsInCloud(
    gdrive: TsGoogleDrive,
    filename: string,
    remoteFolderId: string,
  ): Promise<string | undefined> {
    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolderId)
      .setNameEqual(path.basename(filename));

    if (query.hasNextPage()) {
      const files = await query.run();
      return files.length > 0 ? files[0].id : undefined;
    }
    return undefined;
  }
}
