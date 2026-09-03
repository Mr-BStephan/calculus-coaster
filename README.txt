CALCULUS COASTER SIMULATOR — VERSION 1
Mr. Stephan / AP Calculus AB

FILES
- index.html
- style.css
- app.js

HOW TO RUN LOCALLY
1. Keep all three files in the same folder.
2. Open index.html in Chrome/Edge.
3. Internet access is currently required because index.html loads math.js from a CDN.
   (A later version can bundle the library for fully offline use.)
4. For easier development in VS Code, use the Live Server extension.

DEFAULT CLASS COURSE
- Horizontal length: 100 m
- Allowed vertical height: 0 m to 40 m
- Initial cart speed: 1.5 m/s
- Gravity: 9.81 m/s^2
- No friction or air resistance

STUDENT INPUT
Paste one Desmos restricted function per line, for example:
y=35-18*(3*(x/40)^2-2*(x/40)^3) {0<=x<=40}

The parser supports common pasted Desmos/LaTeX syntax such as:
\sin, \cos, \tan, \sqrt{}, \frac{}{}, \pi, \ln, \log,
and restrictions such as \{0\le x\le 20\}.

CURRENT CALCULUS CHECKS
- Covers x = 0 through x = 100
- Height stays between 0 m and 40 m
- Continuity at each piecewise joint
- Matching slopes / differentiability at each joint
- At least one interior local extremum
- Endpoint and slope mismatch report

ROUNDING TOLERANCE
To prevent harmless decimal rounding from causing fake failures:
- x-domain joint tolerance: 0.002 m
- height mismatch tolerance: 0.05 m
- slope mismatch tolerance: 0.03

The program still shows the actual measured mismatch so students can see it.
A mismatch larger than the tolerance causes a derail in the simulation.

CURRENT PHYSICS
- Conservation of mechanical energy determines speed from height.
- Cart stops if it does not have enough energy to reach a hill.
- Numerical first/second derivatives estimate slope and curvature.
- Normal force / approximate rider G-force is calculated.
- If the required normal force becomes negative over a crest, the cart
  loses track contact and follows a ballistic projectile path.
- Discontinuous or non-differentiable joints cause a derail.
- Prototype 4 g warning threshold is informational only.

TEACHER SETTINGS
At the top of app.js, change:
COURSE_LENGTH
MAX_HEIGHT
MIN_HEIGHT
INITIAL_SPEED
Y_JOINT_TOL
SLOPE_JOINT_TOL

DESIGN NOTE
This is intentionally a transparent AP Calculus model, not a professional
roller-coaster engineering simulator. Friction, air drag, wheel/rail geometry,
3D banking, structural forces, and real safety standards are not included yet.


V1.1 BUGFIX
- Fixed intermittent false derail at valid piecewise joints.
- Active track piece is now explicit and deterministic during animation.


V1.2 UPDATE
- A derailed or airborne cart no longer ends immediately when it leaves the course.
- The cart continues in projectile motion under gravity until it reaches ground level (y = 0).
- The simulation stops only after ground impact.


V1.3 UPDATE — LIVE PLAYBACK / INSPECTOR
- Added a position slider under the coaster graph.
- During normal playback, the slider follows the cart.
- Dragging the slider pauses playback and places the cart at that x-position.
- Live telemetry updates immediately: height, theoretical speed, slope, G-force, and energy.
- If a slider position is too high for the cart's available energy, the inspector marks it as not physically reachable.
- Slider uses deterministic piece selection at shared piecewise endpoints.


V1.4 UPDATE — EXPLOSIONS
- Added explosion effects when the cart derails at the track.
- Added a larger explosion effect when the cart hits the ground after falling.
- Ground-impact explosions continue animating briefly before the simulation stops.


V1.5 UPDATE
- The cart now disappears immediately on ground impact so the explosion is visible by itself.


V1.6 UPDATE
- Warning/failure messages moved from the graph overlay to the right side of the "2. Ride Simulation" heading.
- Live Playback slider and graph are no longer covered by warnings.
- On narrow screens the warning moves below the heading text instead of overlapping content.


V1.7 UPDATE
- Added a subtle scenic background inside the graph area: soft sky, faint hills, and a semi-transparent tree for scale.
- Added a black cat riding in the cart.
- Background elements are intentionally light/transparent so the graph, track, and cart remain easy to read.


V1.8 UPDATE — CAT PASS-OUT GRAPHIC
- Added a teacher-editable CAT_PASS_OUT_G threshold (currently 4.0 g).
- If the felt G-force reaches or exceeds that threshold, the cat visually passes out in the cart.
- The cat lies horizontally and shows dizzy / knocked-out graphics.
- This also works while using the live playback slider to inspect a point.


V1.9 UPDATE — EARLY END OF SINGLE TRACK
- A single function is now allowed to physically end before x = 100 m.
- During playback, reaching that endpoint launches the cart with its tangent velocity.
- The cart then follows projectile motion under gravity until ground impact.
- The calculus report still warns that the track does not cover the full course.
- The playback slider beyond the endpoint now says "TRACK ENDED" instead of treating it like an accidental internal gap.
- Multi-piece internal gaps still count as true track-gap failures.


V2.0 UPDATE — PROJECTOR MODE + CART SIZE
- Added Projector Mode using the browser Fullscreen API.
- Projector Mode shows the entire Ride Simulation area: graph, live playback, and telemetry.
- Added Run and Reset controls inside the Ride Simulation header so playback can be controlled while fullscreen.
- Press Esc or click "Exit Projector Mode" to leave fullscreen.
- Added a Cart Size slider from 0.7x to 2.2x.
- Cart size scales the cart, black cat, and wheels together; physics is unchanged.


V2.1 UPDATE — AXIS LABELS
- Centered "x (m)" beneath the graph.
- Centered "height (m)" vertically along the left side.
- Axis titles are now separated from the numeric tick labels.


V2.2 UPDATE — PLAYBACK TOOLBAR LAYOUT
- Kept warning/error messages beside the "2. Ride Simulation" heading.
- Moved Run, Reset, and Projector Mode into a toolbar directly below the graph.
- Moved Cart Size into that toolbar.
- Moved Animation Speed next to Cart Size and added a live numeric speed readout.
- Live Playback / Inspect Track now sits directly below the playback/settings toolbar.
- Removed duplicate Run/Reset/Animation controls from the equation-entry area.


V2.3 UPDATE — SPEED / G-FORCE COLOR CODING
- Live Speed and G-force telemetry are now color coded green / yellow / red.
- Default speed thresholds:
  green < 15 m/s
  yellow 15–24.9 m/s
  red >= 25 m/s
- Default G-force thresholds:
  green < 3.0 g
  yellow 3.0–3.99 g
  red >= 4.0 g
- Thresholds are teacher-editable near the top of app.js.
- The red G-force threshold matches the current cat pass-out threshold.


V2.4 UPDATE — MAXIMUM SPEED REPORT
- Added "Maximum speed" to the Calculus & Engineering Report summary cards.
- Added a detailed "Maximum speed reached" report row.
- Maximum speed is calculated from all physically reachable sampled points on the track.
- The report uses the same green / yellow / red thresholds as the live speed telemetry.


V2.5 UPDATE — TRUE DIRECTION REVERSAL
- Added bidirectional on-track motion.
- If the cart climbs until its kinetic energy reaches zero, it now reverses direction instead of stopping.
- Turning points are solved numerically by bisection so the cart reverses at the correct energy height rather than overshooting.
- Piecewise joints are now crossed correctly in both directions.
- Derail / airborne tangent velocity respects the current direction of travel.
- The cart graphic rotates to face its direction of motion.
- Live speed telemetry shows a left/right arrow while the cart is on the track.
- The energy report now describes an unreachable hill as a predicted turning point rather than a hard failure.
- With no friction, a suitable bowl-shaped track can oscillate indefinitely.


V2.6 BUGFIX — REVERSAL STABILITY / GRAPHICS
- Fixed reversal chatter where the cart could rapidly flip left/right at the turning point.
- After a reversal the cart is nudged 0.015 m back into the physically reachable region, giving it a small positive speed on the next frame.
- Reused the same stable reversal behavior for near-zero-speed numerical cases.
- Fixed the cart/cat flipping upside down during leftward travel. The cart now remains aligned upright with the track tangent in both directions.


V2.7 UPDATE — FULL SCREEN LABEL
- Renamed "Projector Mode" to "Full Screen" throughout the interface.
- Exit button now reads "Exit Full Screen".


V2.8 UPDATE — PERSISTENT PASS-OUT GRAPHIC
- Once the cat experiences G-force at or above CAT_PASS_OUT_G, it stays passed out for the remainder of that simulation run.
- The pass-out state clears when you press Reset or start a fresh run/inspection.


V2.9 UPDATE — CONTINUOUS BUT NON-DIFFERENTIABLE JOINTS
- A continuous corner/cusp no longer derails the cart.
- The cart remains on the rail and continues onto the next function piece.
- At the instant of the non-differentiable joint, live G-force displays UNDEFINED in red.
- The cart briefly shakes and shows sparks to visualize the instantaneous jolt.
- The cat immediately passes out and remains passed out for the rest of that run.
- The engineering report now explains that an idealized corner/cusp has undefined acceleration/G-force.
- A true discontinuity still derails the cart as before.
- Behavior works in both left-to-right and right-to-left travel.


V3.0 UPDATE — EVENT-AWARE LIVE PLAYBACK
- Live Playback is no longer only a static track inspector.
- Dragging the slider across a continuous non-differentiable joint now replays the jolt/shake/sparks animation, flashes G-force as UNDEFINED, shows the warning, and passes out the cat.
- The cat remains passed out at later slider positions after a high-G event or cusp/corner, matching the replay timeline.
- Dragging across a discontinuity previews the derail point with an explosion and warning; Run Coaster still shows the full airborne crash trajectory.
- Live Playback now warns when crossing a loss-of-contact point, when inspecting an energy-unreachable point, and when crossing a >= CAT_PASS_OUT_G region.
- A separate inspection animation loop lets visual effects run while the slider itself remains stationary.


V3.1 UPDATE — EXAMPLE PRESET PICKER
- Replaced the single "Load working example" button with a dropdown + Load example button.
- Added four built-in examples:
  1. Working coaster — continuous, differentiable, full 100 m course.
  2. Continuous, not differentiable — V-shaped corner at x=50; cart stays on track and G-force becomes UNDEFINED.
  3. Too much G-force — cosine valley that produces extremely high G-force and makes the cat pass out.
  4. Pendulum / reversal — asymmetric bowl that runs out of mechanical energy before x=100 and reverses direction.


V3.2 UPDATE — MORE EXAMPLE PRESETS
Added three more built-in examples:
5. Discontinuous / derails — a jump discontinuity at x=50; the cart derails.
6. Loses contact / airborne — a smooth cosine-based track where speed and curvature cause loss of contact.
7. Track ends early — the rail stops at x=60 and the cart launches off the endpoint.


CHROMEBOOK DEPLOYMENT BUILD
---------------------------
This edition removes the external math-library CDN request. A restricted
expression compiler is included directly in app.js so the simulator can be
served as a self-contained static website.


V3.6 BUGFIX — DIRECT DESMOS FUNCTION PASTE
- Direct Desmos clipboard forms that omit function parentheses now work, including \ln x and \sin x.
- Existing parenthesized forms such as \cos(x) continue to work.
- Explicit LaTeX spacing before a domain restriction (backslash + space) is ignored, preventing a second paste error on some Desmos expressions.
