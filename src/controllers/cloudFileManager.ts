/* eslint-disable no-restricted-syntax */
import { TsGoogleDrive } from 'ts-google-drive';
import path from 'path';
import fs from 'fs';

export default class CloudFileManager {
  public gdrive: TsGoogleDrive;

  constructor(oldCloud = false) {
    this.gdrive = oldCloud
      ? CloudFileManager.getOldTsGoogleDrive()
      : CloudFileManager.getTsGoogleDrive();
  }

  public static getTsGoogleDrive(): TsGoogleDrive {
    return new TsGoogleDrive({
      credentials: {
        client_email: process.env.GDRIVE_CLIENT_EMAIL,
        private_key: String(process.env.GDRIVE_PRIVATE_KEY).replace(
          /\\n/g,
          '\n',
        ),
      },
    });
  }

  public static getOldTsGoogleDrive(): TsGoogleDrive {
    return new TsGoogleDrive({
      credentials: {
        client_email: process.env.OLD_GDRIVE_CLIENT_EMAIL,
        private_key: String(process.env.OLD_GDRIVE_PRIVATE_KEY).replace(
          /\\n/g,
          '\n',
        ),
      },
    });
  }

  public static async downloadFileCloud(
    gdrive: TsGoogleDrive,
    pathFile: string,
    remoteFolderId: string,
  ): Promise<boolean> {
    const remoteFolder = await gdrive.getFile(remoteFolderId);
    if (!remoteFolder)
      throw new Error(
        `Download file from cloud failed - Remote folder Id not found: ${remoteFolderId}`,
      );

    const query = gdrive
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

  public async downloadFileCloud(
    pathFile: string,
    remoteFolderId: string,
  ): Promise<boolean> {
    return CloudFileManager.downloadFileCloud(
      this.gdrive,
      pathFile,
      remoteFolderId,
    );
  }

  public static async uploadFileCloud(
    gdrive: TsGoogleDrive,
    pathFile: string,
    remoteFolder: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    let found = false;
    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolder)
      .setNameEqual(path.basename(pathFile));
    while (query.hasNextPage()) {
      const files = await query.run();

      for await (const file of files) {
        if (deleteIfExists) await file.delete();
        else found = true;
      }
    }

    if (!found || uploadIfExists || deleteIfExists) {
      await gdrive.upload(pathFile, {
        parent: remoteFolder,
      });
    }
  }

  public async uploadFileCloud(
    pathFile: string,
    remoteFolder: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    return CloudFileManager.uploadFileCloud(
      this.gdrive,
      pathFile,
      remoteFolder,
      deleteIfExists,
      uploadIfExists,
    );
  }

  public static async fileExistsInCloud(
    gdrive: TsGoogleDrive,
    filename: string,
    remoteFolder: string,
  ): Promise<boolean> {
    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolder)
      .setNameEqual(path.basename(filename));

    if (query.hasNextPage()) return (await query.run()).length > 0;

    return false;
  }

  public async fileExistsInCloud(
    filename: string,
    remoteFolder: string,
  ): Promise<boolean> {
    return CloudFileManager.fileExistsInCloud(
      this.gdrive,
      filename,
      remoteFolder,
    );
  }
}
