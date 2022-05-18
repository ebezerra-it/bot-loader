import archiver from 'archiver';
import unzipper from 'unzipper';
import path from 'path';
import fs from 'fs';

export default class ZipFileManager {
  public static async unzipSingleFile(pathFilename: string): Promise<string> {
    const dir = await unzipper.Open.file(pathFilename);
    if (!dir || dir.files.length !== 1)
      throw new Error(`Incompatible zip file: ${JSON.stringify(dir.files)}`);

    const unzipFilePath = pathFilename
      .split('.')
      .slice(0, -1)
      .join('.')
      .concat('.csv');

    return new Promise((resolve, reject) => {
      dir.files[0]
        .stream()
        .pipe(fs.createWriteStream(unzipFilePath))
        .on('close', () => resolve(unzipFilePath))
        .on('error', error => reject(error));
    });
  }

  public static async compactSingleFile(
    pathFileName: string,
    zipFileName?: string,
  ): Promise<string> {
    if (!fs.existsSync(pathFileName))
      throw new Error(`File not found: ${pathFileName}`);

    return new Promise((resolve, reject) => {
      let pathZipFilename: string;
      if (zipFileName) {
        pathZipFilename = path.join(path.dirname(pathFileName), zipFileName);
      } else {
        pathZipFilename = path.join(
          path.dirname(pathFileName),
          `${path.basename(pathFileName, path.extname(pathFileName))}.zip`,
        );
      }
      const fsZipFile = fs.createWriteStream(pathZipFilename);
      const archive = archiver('zip', {
        zlib: {
          level: 9,
        },
      });
      fsZipFile.on('close', () => {
        resolve(pathZipFilename);
      });

      archive.on('error', err => {
        reject(err);
      });

      archive.pipe(fsZipFile);
      archive.file(pathFileName, { name: path.basename(pathFileName) });
      archive.finalize();
    });
  }

  public static async unzipFile(zipPathFilename: string): Promise<string[]> {
    const dir = await unzipper.Open.file(zipPathFilename);

    if (!dir) throw new Error(`Incompatible zip file: ${zipPathFilename}`);
    if (dir.files.length === 0)
      throw new Error(
        `Empty zip file: ${zipPathFilename} - ${JSON.stringify(
          dir.files.map(f => f.path),
        )}`,
      );

    await dir.extract({ path: path.dirname(zipPathFilename) });

    return dir.files
      .filter(f => f.type === 'File')
      .map(f =>
        path.join(path.dirname(zipPathFilename), path.basename(f.path)),
      );
  }

  public static async unzipFirstFileNamed(
    zipPathFilename: string,
    firstFilename: string,
  ): Promise<string> {
    const dir = await unzipper.Open.file(zipPathFilename);
    if (!dir || dir.files.length !== 1)
      throw new Error(`Incompatible zip file: ${JSON.stringify(dir.files)}`);

    const unzipFilePathName = path.join(
      path.dirname(zipPathFilename),
      firstFilename,
    );

    return new Promise((resolve, reject) => {
      dir.files[0]
        .stream()
        .pipe(fs.createWriteStream(unzipFilePathName))
        .on('close', () => resolve(unzipFilePathName))
        .on('error', error => reject(error));
    });
  }

  public static async unzipFileNamed(
    zipPathFilename: string,
    filename: string,
  ): Promise<string> {
    const dir = await unzipper.Open.file(zipPathFilename);
    if (!dir)
      throw new Error(
        `[UnzipFile] Can't find zipfile ${path.basename(zipPathFilename)}`,
      );

    const file = dir.files.find(f => path.basename(f.path) === filename);
    if (!file)
      throw new Error(
        `[UnzipFile] Can't find file ${filename} in zipfile ${path.basename(
          zipPathFilename,
        )}`,
      );

    const unzipFilePathName = path.join(
      path.dirname(zipPathFilename),
      filename,
    );

    return new Promise((resolve, reject) => {
      file
        .stream()
        .pipe(fs.createWriteStream(unzipFilePathName))
        .on('close', () => resolve(unzipFilePathName))
        .on('error', error => reject(error));
    });
  }
}
