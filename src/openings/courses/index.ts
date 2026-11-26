// Every opening course. No runtime imports beyond the content, so the scripts can load it too.
import type { Course } from "../courseTypes";
import { KID_COURSE } from "./kid.ts";
import { LONDON_COURSE } from "./london.ts";

export const COURSES: Course[] = [KID_COURSE, LONDON_COURSE];
