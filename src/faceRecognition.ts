import * as faceapi from '@vladmandic/face-api';

export interface StudentFaceEntry {
  id: number;
  name: string;
  roll_number: string;
  seat_number: string;
  class: string;
  photo: string;
}

export interface FaceMatchResult {
  status:
    | 'matched'
    | 'unknown'
    | 'no_face'
    | 'multiple_faces'
    | 'low_confidence'
    | 'no_enrolled_students';
  student?: StudentFaceEntry;
  distance?: number;
  confidence?: number;
  detectionScore?: number;
  faceCount: number;
  message: string;
}

const DESCRIPTOR_CACHE_KEY = 'smart_att_face_descriptors_v1';

interface CachedDescriptor {
  photoKey: string;
  descriptor: number[];
}

export class RealFaceRecognitionEngine {
  private modelsLoaded = false;
  private loadingPromise: Promise<void> | null = null;
  private descriptors = new Map<number, Float32Array>();
  private enrolledPhotoKeys = new Map<number, string>();

  constructor() {
    this.restoreDescriptorCache();
  }

  private getPhotoKey(photo: string): string {
    if (!photo) return '';
    if (photo.length <= 120) return photo;
    return `${photo.slice(0, 48)}:${photo.slice(-32)}:${photo.length}`;
  }

  private restoreDescriptorCache() {
    try {
      const raw = localStorage.getItem(DESCRIPTOR_CACHE_KEY);
      if (!raw) return;
      const parsed: Record<string, CachedDescriptor> = JSON.parse(raw);
      Object.entries(parsed).forEach(([idStr, item]) => {
        const id = Number(idStr);
        if (
          !Number.isNaN(id) &&
          item &&
          Array.isArray(item.descriptor) &&
          item.descriptor.length === 128
        ) {
          this.descriptors.set(id, new Float32Array(item.descriptor));
          this.enrolledPhotoKeys.set(id, item.photoKey);
        }
      });
    } catch {
      // Ignore corrupt cache safely
    }
  }

  private persistDescriptorCache() {
    try {
      const payload: Record<string, CachedDescriptor> = {};
      this.descriptors.forEach((vec, id) => {
        payload[String(id)] = {
          photoKey: this.enrolledPhotoKeys.get(id) || '',
          descriptor: Array.from(vec),
        };
      });
      localStorage.setItem(DESCRIPTOR_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }

  public isModelsReady(): boolean {
    return this.modelsLoaded;
  }

  public async ensureModelsLoaded(): Promise<void> {
    if (this.modelsLoaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      const modelUrl = '/models';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
      ]);
      this.modelsLoaded = true;
    })();

    try {
      await this.loadingPromise;
    } catch (err) {
      this.loadingPromise = null;
      throw err;
    }
  }

  public loadImageForDetection(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!src.startsWith('data:') && !src.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Unable to load student photo for biometric indexing`));
      img.src = src;
    });
  }

  public async extractDescriptorFromImage(
    img: HTMLImageElement | HTMLCanvasElement
  ): Promise<{ descriptor: Float32Array; score: number } | null> {
    await this.ensureModelsLoaded();

    // Try SSD MobileNet v1 first for highest accuracy on portrait photos
    let detection = await faceapi
      .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    // Fallback to TinyFaceDetector if portrait is tight or low resolution
    if (!detection) {
      detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
    }

    if (!detection) return null;
    return {
      descriptor: detection.descriptor,
      score: detection.detection.score,
    };
  }

  public async enrollStudent(student: StudentFaceEntry, force = false): Promise<boolean> {
    const key = this.getPhotoKey(student.photo);
    if (
      !force &&
      this.descriptors.has(student.id) &&
      this.enrolledPhotoKeys.get(student.id) === key
    ) {
      return true;
    }

    if (!student.photo || student.photo.includes('ui-avatars.com')) {
      this.descriptors.delete(student.id);
      this.enrolledPhotoKeys.delete(student.id);
      this.persistDescriptorCache();
      return false;
    }

    try {
      const img = await this.loadImageForDetection(student.photo);
      const extracted = await this.extractDescriptorFromImage(img);
      if (extracted) {
        this.descriptors.set(student.id, extracted.descriptor);
        this.enrolledPhotoKeys.set(student.id, key);
        this.persistDescriptorCache();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public removeStudent(studentId: number) {
    this.descriptors.delete(studentId);
    this.enrolledPhotoKeys.delete(studentId);
    this.persistDescriptorCache();
  }

  public async enrollAllStudents(
    students: StudentFaceEntry[],
    onProgress?: (done: number, total: number, enrolled: number) => void
  ): Promise<{ total: number; enrolled: number; missingIds: number[] }> {
    await this.ensureModelsLoaded();
    let enrolled = 0;
    const missingIds: number[] = [];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const ok = await this.enrollStudent(s);
      if (ok) enrolled++;
      else missingIds.push(s.id);
      if (onProgress) onProgress(i + 1, students.length, enrolled);
    }

    return { total: students.length, enrolled, missingIds };
  }

  public getEnrolledCount(): number {
    return this.descriptors.size;
  }

  public isStudentEnrolled(studentId: number): boolean {
    return this.descriptors.has(studentId);
  }

  public getDescriptorArray(studentId: number): number[] | null {
    const vec = this.descriptors.get(studentId);
    return vec ? Array.from(vec) : null;
  }

  public findBestMatch(
    queryDescriptor: Float32Array,
    students: StudentFaceEntry[],
    distanceThreshold: number
  ): { student: StudentFaceEntry | null; distance: number } {
    let bestStudent: StudentFaceEntry | null = null;
    let bestDistance = Infinity;

    for (const student of students) {
      const enrolledVec = this.descriptors.get(student.id);
      if (!enrolledVec) continue;
      const dist = faceapi.euclideanDistance(queryDescriptor, enrolledVec);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestStudent = student;
      }
    }

    if (bestStudent && bestDistance <= distanceThreshold) {
      return { student: bestStudent, distance: bestDistance };
    }
    return { student: null, distance: bestDistance };
  }

  public async detectAndMatchFrame(
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement | null,
    students: StudentFaceEntry[],
    options: {
      distanceThreshold: number;
      minDetectionConfidence: number;
      useHighAccuracy?: boolean;
    }
  ): Promise<FaceMatchResult> {
    await this.ensureModelsLoaded();

    const width =
      input instanceof HTMLVideoElement ? input.videoWidth : input.width;
    const height =
      input instanceof HTMLVideoElement ? input.videoHeight : input.height;

    if (!width || !height) {
      return {
        status: 'no_face',
        faceCount: 0,
        message: 'Camera frame not ready yet.',
      };
    }

    const detectorOpts = options.useHighAccuracy
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 });

    const detections = await faceapi
      .detectAllFaces(input, detectorOpts)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (overlayCanvas) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    }

    if (detections.length === 0) {
      return {
        status: 'no_face',
        faceCount: 0,
        message: 'No face detected inside camera frame.',
      };
    }

    if (detections.length > 1) {
      if (overlayCanvas) {
        this.drawOverlays(overlayCanvas, detections, 'MULTIPLE FACES', '#f59e0b');
      }
      return {
        status: 'multiple_faces',
        faceCount: detections.length,
        message: `${detections.length} faces detected. Only one student may stand in the entry zone.`,
      };
    }

    const det = detections[0];
    const detScore = det.detection.score;

    if (detScore < options.minDetectionConfidence || det.detection.box.width < 40) {
      if (overlayCanvas) {
        this.drawOverlays(
          overlayCanvas,
          detections,
          `LOW CONFIDENCE (${Math.round(detScore * 100)}%)`,
          '#f59e0b'
        );
      }
      return {
        status: 'low_confidence',
        faceCount: 1,
        detectionScore: detScore,
        message: `Low detection confidence (${Math.round(detScore * 100)}%). Move closer and ensure clear front lighting.`,
      };
    }

    if (this.descriptors.size === 0) {
      if (overlayCanvas) {
        this.drawOverlays(overlayCanvas, detections, 'NO BIOMETRIC INDEX', '#ef4444');
      }
      return {
        status: 'no_enrolled_students',
        faceCount: 1,
        detectionScore: detScore,
        message: 'No student face descriptors enrolled yet. Wait for enrollment or register clear student photos.',
      };
    }

    const { student, distance } = this.findBestMatch(
      det.descriptor,
      students,
      options.distanceThreshold
    );

    const similarity = Math.round(Math.max(0, Math.min(99.9, (1 - distance) * 100)) * 10) / 10;

    if (!student) {
      if (overlayCanvas) {
        this.drawOverlays(
          overlayCanvas,
          detections,
          `UNKNOWN FACE (dist ${distance.toFixed(2)})`,
          '#ef4444'
        );
      }
      return {
        status: 'unknown',
        faceCount: 1,
        distance,
        confidence: similarity,
        detectionScore: detScore,
        message: `Unknown face rejected (Euclidean distance ${distance.toFixed(3)} > threshold ${options.distanceThreshold}).`,
      };
    }

    if (overlayCanvas) {
      this.drawOverlays(
        overlayCanvas,
        detections,
        `${student.name} (${similarity}%)`,
        '#22c55e'
      );
    }

    return {
      status: 'matched',
      student,
      distance,
      confidence: similarity,
      detectionScore: detScore,
      faceCount: 1,
      message: `Matched ${student.name} (${student.roll_number}) — distance ${distance.toFixed(3)}`,
    };
  }

  private drawOverlays(
    canvas: HTMLCanvasElement,
    detections: faceapi.WithFaceDescriptor<
      faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>
    >[],
    label: string,
    color: string
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    detections.forEach((det) => {
      const box = det.detection.box;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Draw facial landmarks
      ctx.fillStyle = '#38bdf8';
      det.landmarks.positions.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Label tag above box
      ctx.font = 'bold 13px Inter, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const tagY = Math.max(24, box.y);
      ctx.fillStyle = color;
      ctx.fillRect(box.x, tagY - 24, textWidth + 14, 24);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, box.x + 7, tagY - 7);
    });
  }
}

export const faceEngine = new RealFaceRecognitionEngine();
