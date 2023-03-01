import tf from '@tensorflow/tfjs';
import { DateTime } from 'luxon';
import path from 'path';
import fs from 'fs';
import { QueryFactory } from '../../db/queryFactory';

export default abstract class baseIAAnalyser {
  public name: string;

  public dateRef: DateTime;

  public queryFactory: QueryFactory;

  public csvColumnsConfig: { [key: string]: tf.data.ColumnConfig };

  public model: tf.LayersModel;

  constructor(
    name: string,
    dateRef: DateTime,
    queryFactory: QueryFactory,
    csvColumnsConfig: { [key: string]: tf.data.ColumnConfig },
  ) {
    this.name = name;
    this.dateRef = dateRef;
    this.queryFactory = queryFactory;
    this.csvColumnsConfig = csvColumnsConfig;
    if (
      Object.keys(this.csvColumnsConfig).filter(
        key => !this.csvColumnsConfig[key].isLabel,
      ).length === 0
    )
      throw new Error(`Wrong csv columns without any non label column.`);

    if (
      Object.keys(this.csvColumnsConfig).filter(
        key => this.csvColumnsConfig[key].isLabel,
      ).length === 0
    )
      throw new Error(`Wrong csv columns without any label column.`);
  }

  public async loadModel(dateRef: DateTime, forceBuild = false): Promise<void> {
    const pathToModel = path.join(
      __dirname,
      '../../../../ai-data',
      `ai_${this.name}_${dateRef.toFormat('yyyyMMdd')}.model`,
    );

    if (fs.existsSync(pathToModel) && !forceBuild)
      this.model = await tf.loadLayersModel(`file://${pathToModel}`);
    else this.model = this.buildModel();
  }

  public abstract buildModel(): tf.LayersModel;

  public abstract trainModel(dateRef: DateTime): Promise<tf.History>;

  public abstract predict(): any | undefined;
}

/* const model = tf.sequential();

model.add(tf.layers.dense({ units: 1, inputShape: [1] }));

// Prepare the model for training: Specify the loss and the optimizer.
model.compile({ loss: 'meanSquaredError', optimizer: 'sgd' });

// Generate some synthetic data for training. (y = 2x - 1)
const xs = tf.tensor2d([-1, 0, 1, 2, 3, 4], [6, 1]);
const ys = tf.tensor2d([-3, -1, 1, 3, 5, 7], [6, 1]);

// Train the model using the data.
await model.fit(xs, ys, { epochs: 250 }); */
