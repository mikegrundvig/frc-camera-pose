# FRC camera pose

A small web page that helps an FRC team decide whether where they plan to put their AprilTag
cameras is a good idea. Put the robot on the field, place its cameras, and see what each one sees
from that spot and how much of the field the layout covers. It runs entirely in the browser: no
server, no account, nothing to install.

## Using it

- **Season.** 2026, 2025 or 2024, with that season's AprilTags. Each tag is drawn as a short bar
  with a tick on the side it can be read from. The field elements (hubs, trenches, towers; the reef
  and barge; the stage and speakers) are drawn in gray and block the cameras' view.
- **Units.** The Units menu at the top picks imperial (the default) or metric. Imperial shows field
  positions in feet (typed with decimals, shown in lists as feet and inches), robot size, camera
  mounts and robot heights in inches, distances in feet and inches, the estimated error in inches,
  and tag detection range in feet; metric shows meters and centimeters. Pixels appear only where
  they are pixels of a camera's image: its resolution, a tag's size in the image, corner noise. The
  choice is kept in this browser, not in the link, and the link and the JSON are always in meters.
- **Robot.** Its length and width with bumpers. Drag it to move it and drag the round
  handle in front of it to turn it (hold Shift for 15 degree steps), or drive it (see Driving). Or pick a spot: the season's starting positions, near
  its main elements, mid-field, by a wall, in a corner. The starting positions are placed for a
  35.5 in robot.
  The robot cannot overlap a field element or leave the field: dragging slides along what it
  touches, a turn that would hit stops short, and a typed position that is in the way moves to the
  nearest place that is not.
- **Driving.** With the field selected (top or 3D), hold W A S D or the arrow keys to drive and Q
  and E to turn; Shift is a quarter speed. Full speed is 3 m/s and 180 degrees a second. The Drive
  menu under the field picks what forward means: field-relative (the default; W is away from the
  blue alliance wall, A toward the field's +y side) or robot-relative (W is the way the robot
  faces). The path does not depend on the frame rate, and the robot slides along elements, walls
  and other robots as it does when dragged. A gamepad works too: the left stick drives, the right
  stick's side turns, a trigger slows. Typing in a box never drives. The maps do not depend on where
  the robot is, so they are not worked out again while it drives.
- **Cameras.** Up to eight. Each has a name, a lens (a preset or your own resolution and field of
  view), where it sits (forward, left and up from the robot's center on the floor), and
  which way it points (yaw, turning left from straight ahead, and tilt up from level). The default
  is a camera at each corner, turned 45 degrees out, 21 in up, tilted up 10 degrees.
- **What each camera sees from here.** Each camera's view is drawn from above, with a line to every
  tag it detects (dashed to a tag something hides). The table lists each tag seen, how many pixels
  wide it is in the camera's image and how far away, and why a tag in the camera's view is not seen: facing away,
  outside the image, too far, too small, or behind a field element or another robot.
- **Camera's view.** Pick a camera (its card, the menu above the picture, or its view on the field)
  and see its image as it makes it: the frame at the camera's resolution, the horizon, and each tag
  as the four corners it lands on, with its number and size in pixels, or dashed with why it is not
  seen. It follows the robot and the camera's settings as they change.
- **Over the whole field.** The layout is scored at positions about a foot and a half (half a meter) apart, at eight
  headings each, and the page shows four maps: at least one tag seen, two or more tags in one
  camera, two or more cameras seeing a tag, and the estimated position error. Under the maps are
  the share of the field for each, the error 95% of the field is within, the same with any one
  camera lost (the worst camera to lose), and the worst spots.
- **Find a layout.** A search for the cameras that give the current field (with its elements) the
  lowest 95% position error, one to six of them, on the robot's edges only: its four corners and
  four side middles, mounted just inside the bumper as the presets are. Each camera has its own yaw
  (facing out from its edge, turned up to 45 degrees either side in 15 degree steps; at a corner that
  is from facing one edge's way to facing the other's), height (6 in, then every 4 in from 8 in to the
  robot's height, and the height itself; the robot's height is set under Robot, 30 in by default) and
  tilt (0 to 30 degrees in 5 degree steps). Left and right are mirrored by default (a camera on the
  left implies one on the right; an odd count puts one straight out at the front or back); a box
  turns that off. A box, "One camera to a place" (off by default), forbids two cameras at the same corner or side
  middle (a mirrored pair holds both its places); without it the search may put two cameras at one
  place with different yaws, heights or tilts. Every camera uses the lens of the camera selected when
  you start. The table gives,
  for each count, the best layout's 95% error and the error with the worst camera lost, both on the
  whole map, a line describing the layout, and a button to put it on the robot (undo restores the
  cameras you had). The star marks the fewest cameras within 1 mm of the best, as the study ties
  them. Differences under about 1 mm are noise, and the estimate's assumptions (below) apply. A box
  puts other robots in the way (as many as are placed, or three, at random); it is about four times
  slower. How it works, in the browser's workers: one camera's view at a pose does not depend on
  the others, so every camera the search could place (3,136 for a 30 in robot; fewer when views across the robot are not allowed) is looked at once over
  a coarse set of poses (a grid 1 m apart, 4 headings at each, about 400 poses) and kept in a table;
  a layout is scored by combining table rows. Then, for each count: a greedy build (the best camera;
  then the camera, or mirrored pair, that most improves the layout), improved by moving one camera a
  step at a time (to the next place round the edge, a yaw, height or tilt step) while that helps,
  and 200 seeded random starting layouts improved the same way; the best is kept, and the best of
  each count is scored on the page's own map. Layouts that do not cover 95% of the field rank below
  all that do, by the share of poses measured. It takes about ten seconds with eight workers
  (under a minute with other robots in the way).
- **Best angles.** For robots whose cameras can only go in certain places: keep every camera's mount
  (forward, left, up) exactly as it is and let the search choose each camera's yaw and tilt for the
  lowest 95% position error over the current field (with its elements, units, distance cutoff and,
  if asked, other robots in the way). Yaw goes in 5 degree steps (any direction, or within the yaw
  range in the camera's card, which may wrap past 180 degrees, such as 150 to -150) and tilt in 5
  degree steps (0 to 30, or the tilt range in the card; an empty limit means none). Each camera's
  limits are the way to say which directions its mount blocks: the search does not know the robot's
  own mechanisms, so use the limits and the camera's view to rule out directions that are blocked. By
  default only views that face out of the robot are tried (see Views across the robot).
  Optionally "Use the best N of these mounts" also chooses which of the mounts to keep.
  How: the same table of camera views over a coarse set of poses as Find a layout (one camera's view
  does not depend on the others), here with the candidates being each mount at every allowed yaw and
  tilt; then coordinate descent from the current angles (each camera in turn takes the angles that
  score best with the others held, until a sweep changes nothing) and 24 seeded random starts, the
  best kept; to choose N mounts, a greedy choice of the mount that gains most with its best angles,
  then swaps of a kept mount for a dropped one while that helps, with random starts too. The answer
  is scored on the whole map and shown before and after (95% error, with one camera lost, and the
  coverage shares), with each camera's angles now and suggested, and its slack: the yaw range and
  the tilt range (holding the other cameras and the other angle) over which the 95% error stays within
  1 mm of the best. Apply puts the angles on the robot (and removes mounts not used); Undo restores
  the cameras you had. The limits are saved in the link.
- **Views across the robot.** A camera is on its robot, and a view that looks across it sees the
  robot, not the field. From above, the robot is its bumper rectangle and a camera a point inside it;
  the rule is that no ray of the camera's horizontal field of view may run inside the outline for more
  than a set length, 14 in by default (the "A view may cross the robot for up to" box under Cameras,
  from 6 in to 36 in, in the link). That is the presets' 6 in inset seen at up to 60 degrees to the
  face (12 in) and 2 in over, a judgement, since a camera behind the bumpers always looks over some
  of its robot; tighten it if something on your robot stands at camera height. At 14 in, for a 35.5 in robot with a 70.9 degree lens a front-left corner camera faces out for yaws
  from -29 to 119 degrees, a side middle one for 29 degrees either side of straight out, and a camera
  in the middle of the robot never does. The height of the view is ignored (cameras sit above the
  bumpers), so a camera looking along the top of the robot at a mechanism is not caught: use the
  yaw limits for that. By default Find a layout and Best angles try only views that pass; a camera you
  set by hand that fails is flagged: the part of its view over the robot is tinted in the top view and
  its card says so, with the yaws that would face out. The part of every camera's view that lies over its own robot is always tinted, in the top view and
  on top of the robot in 3D (when camera views are shown): softly, in the camera's color, as
  information, or in the warning color when the rule is on and the view crosses further than allowed.
  The maps still score it as set. The "Allow
  views across the robot" box under Cameras (in the link, since it changes the searches) turns the
  rule off everywhere (the length box is then disabled).
- **Reading the map.** Each square scores its center point at eight headings, so it can differ from
  the view at the robot's exact spot and heading. A heading where the robot would overlap a field
  element is left out of the square, and a square is "no room" (plain) only when the robot fits at
  none of the headings. A square blind at some heading (over 5% of the headings with room have no
  position fix) is hatched in a warm color the scale does not use. Point at a square, in the top
  view or in 3D, to see what it scored, how many headings were measured, and why not at the others
  (no tags in view, tags only farther than the robot uses, no room), or what a no-room square
  overlaps.
- **Other robots.** Up to five, solid boxes the size of your robot that hide tags behind them.
  Add a robot puts one at a clear spot near yours; drag it, turn it by its round handle, select it
  and press Delete or use Remove. They stay where you put them when you move your robot, and they
  are part of the link. Place at random puts the ones you have at random places near your robot,
  once. Nothing overlaps the walls, the field elements or another robot. The maps cannot use robots
  placed by hand (they only mean something near one spot), so they assume as many other robots as
  you have placed, at random around each spot, four arrangements to a pose, and say so.
- **Top and 3D.** The Top and 3D buttons over the field switch between the view from above and a 3D
  view you can orbit (drag), pan (right-drag or Shift-drag) and zoom (scroll), with Reset view to
  come back: the floor with the coverage map, walls, field elements as blocks, tags as panels at
  their real height, the robot, each camera's view as a pyramid out 3 m, the sight lines and other
  robots. The Show choices apply to both. In 3D, press on a robot and drag to move it across the
  floor (with the same collision rules as in the top view); pressing anywhere else orbits. Robots are
  turned in the top view.
- **Show.** Under the field, checkboxes turn off what is drawn: the cameras' views, the lines to
  seen and to hidden tags (hidden ones start off), tag numbers, field elements, other robots and the
  coverage map. Blend map smooths the map between grid points (the values are blended, then
  colored; cells with no room for the robot or no measurement keep their own squares); turn it off to
  see the raw cells. What is hidden still counts: elements and robots still block the cameras. The
  choices are kept in this browser, not in the link.
- **Share.** The page keeps everything in its link; copy the link, or copy the setup as JSON.

Camera presets, as their makers publish them (nominal; a real lens differs a little):

| Preset | Resolution | Field of view |
|---|---|---|
| Generic global-shutter camera (the study's) | 1280 x 800 | 80° diagonal |
| Arducam OV9281 (B0332), 70° lens | 1280 x 800 | 70° across |
| Arducam OV2311 (B0322), 75° lens | 1600 x 1200 | 75° across |
| Limelight 3G or 4 | 1280 x 800 | 82° across |
| ThriftyCam, 80° lens | 1600 x 1304 | 80° diagonal |

## What the estimate assumes

The estimated position error follows the "pipeline estimate" of the camera placement study in the
[frc-robot-runtime](https://github.com/mikegrundvig/frc-robot-runtime) repository
(`docs/camera-placement.md`). It is a geometric model with no images and no solves:

- A tag is detected when it is in front of the camera and facing it, within sight range (7 m by
  default), all four corners land inside the image, and it covers at least 100 square pixels.
  PhotonVision's simulation uses the same test, with a perfect pinhole lens.
- Each tag's corners are off by a little noise (a quarter pixel by default). From that, each tag's
  own solve has an uncertainty; a camera averages its tags, nearer ones counting more; the cameras
  are combined by the uncertainty the robot's vision pipeline gives each one; and the gyro's
  heading error (a quarter degree by default) moves every tag's fix by its distance from the
  robot. A camera whose tags average more than 6 m (19 ft 8 in) away is ignored: one robot's rule,
  which the Noise section's distance cutoff sets (or turns off with "No distance cutoff"); teams'
  estimators differ. The cutoff applies to the maps, the view from here, the camera's view and the
  layout search.
- The error is the distance 95% of the field (all positions and headings) is within. If more than
  5% of the field has no measurement at all, there is no such distance: "not enough of the field
  covered".

Its limits, plainly: it is estimated for a robot that solves each tag with its gyro's heading and
averages the cameras, and your estimator may differ. Real cameras are noisier than this model:
motion blur, lighting, lens distortion, a camera knocked off its mount. The robot stands still and
level. Field elements are simplified to upright blocks. Other robots are solid boxes placed
anywhere near the robot, not where a real match puts them. Use it to compare layouts, not to
predict a number on the field.

## Running it locally

Any static web server works (the page loads its field data with `fetch`, so opening the file
directly does not):

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Tests

With Node.js 20 or later, no packages to install:

```sh
node --test
```

The tests check the estimate against the study's own Java implementation on its own poses and five
camera layouts of the 2026 field (every tag count, the error's eigenvalues and the field's numbers
must match), other robots against the study's runs with three to five robots, the sight-line test
against field elements, the camera geometry, where the robot may stand, where a tag lands in a camera's image, the layout search and the best-angle search.
One test, slower (about fifteen seconds), checks the search against the camera placement study's own
family of layouts: on the 2026 field without elements, with left and right mirrored, for one to four
cameras the search's best is as good as the family's best, within a millimeter.

## The 3D view's library

The 3D view uses [three.js](https://threejs.org) 0.181.1 (MIT), in `vendor/three/`: `three.module.min.js`
and `three.core.min.js` from the `build/` folder of the npm package `three@0.181.1`, and
`OrbitControls.js` from its `examples/jsm/controls/`, as served in the `org.webjars.npm:three:0.181.1`
WebJar on Maven Central. They are unchanged but for one line of `OrbitControls.js`, which imports
`./three.module.min.js` instead of `three` so no import map is needed. The page loads them only when
3D is first chosen. The license is in `licenses/three.js-License.md`.

## Where the field data comes from

- `fields/*-crescendo.json`, `*-reefscape-welded.json`, `*-rebuilt-welded.json`: WPILib's AprilTag
  layouts, unchanged, under WPILib's license (`licenses/WPILib-License.md`).
- `fields/*-elements.json`: the field elements, starting positions and places, exported from the
  season models in the [frc-robot-model](https://github.com/mikegrundvig/frc-robot-model) library.

## License

MIT (see `LICENSE`). The WPILib layouts keep their own license.
