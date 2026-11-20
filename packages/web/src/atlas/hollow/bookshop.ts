import {
  AdditiveBlending, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, RingGeometry,
  Vector3, type BufferGeometry, type Material, type Texture,
} from "three";
import { Builder } from "../scene/generic";
import { box, frameAt, hoop } from "../scene/kitParts";
import { bookRow, buildBookshopScene, inkTexture, pigment } from "./bookshopArt";
import { DESK, FLOATING_BOOK, LECTERN, SHELF, SHOP_ARRIVAL, SHOP_LANDMARKS, SHOP_OBSTACLES, SHOP_ROOM } from "./bookshopLayout";
import { HollowInteractions, type InteractionView } from "./interactions";
import { HollowNavigation } from "./navigation";
import { modelSign } from "./courtyard";

const flat = frameAt(0, 0, 0, 0);
const ease = (amount: number, from: number, to: number) => MathUtils.smoothstep(amount, from, to);
const passage = (progress: number, reduced: boolean) => reduced ? 1 : ease(progress, 0, 0.19) * (1 - ease(progress, 0.77, 1));

export class Bookshop {
  readonly navigation = new HollowNavigation(SHOP_OBSTACLES, SHOP_ROOM, SHOP_ARRIVAL);
  readonly interactions: HollowInteractions;
  private readonly art;
  private readonly geometry: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly maps: Texture[] = [];
  private readonly book = new Group();
  private readonly leaves = [new Group(), new Group()];
  private readonly halo;
  private readonly shelf = new Group();
  private readonly spines;
  private readonly key;
  private readonly shelfGlow;
  private readonly shelfSeal;
  private readonly token;
  private readonly noticeBoard = modelSign("", 1.14, 0.27);
  private sealTime = 0;
  private readonly possibilities;
  private renderedEvent: string | null = null;
  private notice = 0;
  private lift = 0;
  private shelfSlide = 0;
  private keyFacing = 0;
  private deskReveal = 0;

  constructor(detail: boolean, publish: (view: InteractionView) => void) {
    this.art = buildBookshopScene(detail);
    const board = this.noticeBoard.mesh;
    board.position.set(DESK.x, 2.05, DESK.z - 0.68);
    board.visible = false;
    this.art.scene.add(board);
    const silver = this.texture(192, 256, ink => {
      const glass = ink.createLinearGradient(0, 0, 180, 256);
      glass.addColorStop(0, "#a9b6ce");
      glass.addColorStop(0.44, "#635f82");
      glass.addColorStop(0.52, "#b9bad5");
      glass.addColorStop(1, "#302943");
      ink.beginPath(); ink.ellipse(96, 128, 84, 118, 0, 0, 2 * Math.PI);
      ink.fillStyle = glass; ink.fill(); ink.strokeStyle = "#d6b47f"; ink.lineWidth = 8; ink.stroke();
      ink.beginPath(); ink.moveTo(96, 194); ink.lineTo(96, 128); ink.lineTo(62, 90);
      ink.moveTo(96, 128); ink.lineTo(130, 90); ink.strokeStyle = "#f5e6d5"; ink.lineWidth = 3; ink.stroke();
    });
    const mirror = new Mesh(this.ownGeometry(new PlaneGeometry(0.96, 1.28)),
      this.material(new MeshBasicMaterial({ map: silver, transparent: true })));
    mirror.position.set(-0.95, 1.76, -4.41);
    this.art.scene.add(mirror);
    this.interactions = new HollowInteractions(SHOP_LANDMARKS, SHOP_OBSTACLES, publish);

    this.book.rotation.x = 0.60;
    this.art.scene.add(this.book);
    const sheets = this.ownGeometry(new PlaneGeometry(0.38, 0.55));
    for (const [i, leaf] of this.leaves.entries()) {
      const side = i === 0 ? -1 : 1;
      const cover = new Builder();
      box(cover, flat, side * 0.212, -0.040, 0, 0.426, 0.052, 0.61, pigment("#503444"));
      box(cover, flat, side * 0.204, 0.012, 0, 0.39, 0.041, 0.552, pigment("#bb976f"));
      box(cover, flat, side * 0.219, -0.045, 0.292, 0.392, 0.018, 0.026, pigment("#b38d55"));
      const paper = this.texture(192, 256, (ink) => {
        ink.fillStyle = "#e3c399"; ink.fillRect(0, 0, 192, 256);
        ink.strokeStyle = "#98674d"; ink.lineWidth = 2; ink.strokeRect(9, 9, 174, 238);
        ink.fillStyle = "#594043"; ink.font = "20px Georgia";
        ink.fillText(i === 0 ? "I. I left" : "II. I stayed", 23, 45);
        ink.lineWidth = 3;
        for (let line = 0; line < 7; line++) {
          ink.beginPath();
          ink.moveTo(25, 75 + line * 8);
          ink.lineTo(130 + 21 * Math.cos(line * 7 + i), 75 + line * 8);
          ink.stroke();
        }
        ink.beginPath(); ink.moveTo(96, 218); ink.lineTo(96, 170); ink.lineTo(i === 0 ? 63 : 129, 144); ink.stroke();
        ink.beginPath(); ink.arc(i === 0 ? 59 : 133, 140, 5, 0, Math.PI * 2); ink.stroke();
      });
      const page = new Mesh(sheets, this.material(new MeshBasicMaterial({ map: paper, side: DoubleSide, color: "#edd9c5" })));
      page.rotation.x = -Math.PI / 2;
      page.position.set(side * 0.212, 0.054, 0);
      leaf.add(this.sculpt(cover), page);
      this.book.add(leaf);
    }
    this.halo = new Mesh(this.ownGeometry(new RingGeometry(0.47, 0.49, 24)), this.material(new MeshBasicMaterial({
      color: "#d4a0ff", side: DoubleSide, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending,
    })));
    this.halo.position.set(LECTERN.x, 1.13, LECTERN.z);
    this.halo.rotation.x = -Math.PI / 2;
    this.art.scene.add(this.halo);

    this.shelf.position.set(SHELF.x, 0, SHELF.z);
    this.shelf.rotation.y = Math.PI / 2;
    const falseSpines = new Builder();
    box(falseSpines, flat, 0, 1.596, 0.17, 1.03, 0.36, 0.12, pigment("#281c24"));
    bookRow(falseSpines, flat, 0, 1.608, 0.25, 1.00, 417);
    this.spines = this.sculpt(falseSpines);
    const brass = new Builder();
    const tint = pigment("#ffda85");
    hoop(brass, new Vector3(0, 0.077, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 0.092, 0.024, 10, 5, tint);
    box(brass, flat, 0, -0.24, 0, 0.045, 0.25, 0.045, tint);
    for (const y of [-0.24, -0.16]) box(brass, flat, 0.05, y, 0, 0.12, 0.042, 0.045, tint);
    this.key = this.sculpt(brass, this.material(new MeshStandardMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0.28, emissive: "#67431d",
    })));
    this.key.position.set(-0.20, 1.85, 0.15);
    this.key.scale.setScalar(1.10);
    this.key.rotation.z = -0.64;
    const card = this.ownGeometry(new PlaneGeometry(1, 1));
    this.shelfGlow = new Mesh(card, this.material(new MeshBasicMaterial({
      map: this.art.soft, color: "#be86fc", transparent: true, blending: AdditiveBlending, depthWrite: false,
    })));
    this.shelfGlow.position.set(-0.20, 1.85, 0.08);
    this.shelfGlow.scale.set(0.72, 0.68, 1);
    this.shelfSeal = new Mesh(this.ownGeometry(new RingGeometry(0.037, 0.065, 4)),
      this.material(new MeshBasicMaterial({ color: "#cba4ef", transparent: true, depthWrite: false })));
    this.shelfSeal.position.set(-0.12, 1.543, 0.445);
    this.shelf.add(this.shelfGlow, this.shelfSeal, this.key, this.spines);
    this.art.scene.add(this.shelf);

    this.token = new Mesh(this.ownGeometry(new OctahedronGeometry(0.128)), this.material(new MeshBasicMaterial({ color: "#c58fea" })));
    this.token.position.set(DESK.x, 1.15, DESK.z);
    const alternatives = this.texture(768, 256, (ink) => {
      for (const i of [0, 1, 2]) {
        const x = i * 256, gold = i === 0 ? "#f4cd91" : "#dfc6ff";
        ink.fillStyle = i === 0 ? "#392237cc" : "#261b46cc";
        ink.fillRect(x + 34, 42, 188, 160);
        ink.strokeStyle = gold; ink.lineWidth = 3; ink.strokeRect(x + 39, 47, 178, 150);
        ink.lineWidth = 6;
        if (i === 0) {
          for (const y of [103, 119, 135]) {
            ink.beginPath(); ink.ellipse(x + 128, y, 43, 15, 0, 0, Math.PI * 2); ink.stroke();
          }
        } else if (i === 1) {
          ink.beginPath(); ink.moveTo(x + 128, 153); ink.lineTo(x + 83, 130); ink.lineTo(x + 83, 91);
          ink.lineTo(x + 128, 111); ink.lineTo(x + 173, 91); ink.lineTo(x + 173, 130); ink.closePath();
          ink.moveTo(x + 128, 111); ink.lineTo(x + 128, 153); ink.stroke();
        } else {
          for (const dx of [-22, 0, 22]) {
            ink.beginPath(); ink.arc(x + 128 + dx, 104, 10, 0, Math.PI * 2); ink.stroke();
            ink.beginPath(); ink.moveTo(x + 128 + dx, 114); ink.lineTo(x + 128 + dx, 147); ink.lineTo(x + 138 + dx, 147); ink.stroke();
          }
        }
      }
    });
    this.possibilities = new Mesh(card, this.material(new MeshBasicMaterial({
      map: alternatives, side: DoubleSide, transparent: true, depthWrite: false,
    })));
    this.possibilities.position.set(DESK.x, 1.63, DESK.z + 0.10);
    this.possibilities.scale.set(1.32, 0.44, 1);
    this.art.scene.add(this.token, this.possibilities);
    this.pose(null, 0, false);
  }

  get scene() { return this.art.scene; }

  inscribe(title: string | null, color: string) {
    this.noticeBoard.mesh.visible = !!title;
    this.noticeBoard.write(title ?? "");
    this.token.material.color.set(color);
    this.sealTime = title ? 0.42 : 0;
  }

  update(step: number, reduced: boolean) {
    if (this.renderedEvent === this.interactions.eventId) this.interactions.advance(step, this.navigation);
    const event = this.interactions.eventId;
    const goal = this.interactions.available(this.navigation, FLOATING_BOOK) ? 1 : 0;
    const noticeChanged = this.notice !== goal;
    if (noticeChanged) {
      const amount = reduced ? 1 : Math.min(1, step * 4);
      this.notice = goal > this.notice ? Math.min(goal, this.notice + amount) : Math.max(goal, this.notice - amount);
    }
    const sealing = this.sealTime > 0;
    if (sealing) {
      this.sealTime = reduced ? 0 : Math.max(0, this.sealTime - step);
      this.noticeBoard.mesh.scale.setScalar(1 + 0.09 * Math.sin(Math.PI * this.sealTime / 0.42));
    }
    if (!noticeChanged && !sealing && !event && !this.renderedEvent) return false;
    if (event === "whispering-shelf" && this.renderedEvent !== event) {
      const toward = this.shelf.worldToLocal(new Vector3(this.navigation.x, 0, this.navigation.z)).sub(this.key.position);
      this.keyFacing = MathUtils.clamp(Math.atan2(toward.x, toward.z), -0.85, 0.85);
    }
    this.renderedEvent = event;
    this.pose(event, this.interactions.progress, reduced);
    return true;
  }

  private pose(event: string | null, progress: number, reduced: boolean) {
    const opening = event === "floating-book" ? passage(progress, reduced) : 0;
    this.lift = this.notice * 0.086 + opening * 0.46;
    this.book.position.set(LECTERN.x, 1.24 + this.lift, LECTERN.z);
    const fold = 1.33 - this.notice * 0.15 - opening * 1.18;
    this.leaves[0]!.rotation.z = -fold;
    this.leaves[1]!.rotation.z = fold;
    this.halo.visible = this.notice > 0 || opening > 0;
    this.halo.material.opacity = 0.28 * this.notice + 0.57 * opening;
    this.halo.scale.setScalar(1 + opening * 0.25);
    this.shelfSlide = event === "whispering-shelf" ? passage(progress, reduced) : 0;
    this.spines.position.x = this.shelfSlide * 0.78;
    this.key.visible = this.shelfSlide > 0.22;
    this.key.rotation.y = this.keyFacing + (reduced ? 0 : this.shelfSlide * Math.sin(progress * 7) * 0.12);
    this.shelfGlow.visible = this.key.visible;
    this.shelfGlow.material.opacity = this.shelfSlide * 0.40;
    this.shelfSeal.material.opacity = 0.62 + this.shelfSlide * 0.38;
    this.deskReveal = event === "keepers-desk" ? passage(progress, reduced) : 0;
    this.token.position.y = 1.15 + this.deskReveal * 0.19;
    this.token.rotation.y = reduced ? 0 : this.deskReveal * progress * Math.PI;
    this.possibilities.visible = this.deskReveal > 0.015;
    this.possibilities.material.opacity = this.deskReveal;
    this.possibilities.position.y = 1.33 + this.deskReveal * 0.46;
  }

  stats() {
    return { bookLift: this.lift, shelfSlide: this.shelfSlide, deskReveal: this.deskReveal };
  }

  private ownGeometry<T extends BufferGeometry>(geometry: T) {
    this.geometry.push(geometry);
    return geometry;
  }

  private material<T extends Material>(material: T) {
    this.materials.push(material);
    return material;
  }

  private texture(width: number, height: number, paint: (ink: CanvasRenderingContext2D) => void) {
    const map = inkTexture(width, height, paint);
    this.maps.push(map);
    return map;
  }

  private sculpt(builder: Builder, material: Material = this.art.solid) {
    return new Mesh(this.ownGeometry(builder.geometry()), material);
  }

  dispose() {
    this.noticeBoard.mesh.geometry.dispose();
    this.noticeBoard.material.dispose();
    this.noticeBoard.texture.dispose();
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const map of this.maps) map.dispose();
    this.art.dispose();
  }
}
