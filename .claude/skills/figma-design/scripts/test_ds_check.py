import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("ds_check", pathlib.Path(__file__).with_name("ds-check.py"))
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)

HT = ds.APP_POLICY["hypertask"]["corners"]


def px(snippet):
    return [p for _, _, p in ds.css_corners(snippet)]


class TailwindCorners(unittest.TestCase):
    def test_sizes(self):
        self.assertEqual(px('className="rounded"'), [4])
        self.assertEqual(px("rounded-sm rounded-xs rounded-none"), [4, 2, 0])
        self.assertEqual(px("rounded-md rounded-lg rounded-xl"), [6, 8, 12])
        self.assertEqual(px("rounded-full"), [ds.ROUND])

    def test_sides_do_not_swallow_sizes(self):
        self.assertEqual(px("rounded-lg"), [8])
        self.assertEqual(px("rounded-l"), [4])
        self.assertEqual(px("rounded-l-lg rounded-tr-full rounded-ee-sm"), [8, ds.ROUND, 4])

    def test_prefixes(self):
        self.assertEqual(px("md:rounded-full hover:!rounded-lg group-hover:rounded-sm"), [ds.ROUND, 8, 4])

    def test_arbitrary(self):
        self.assertEqual(px("rounded-[3px] rounded-[0.25rem]"), [3, 4])
        self.assertEqual(px("rounded-[50%] rounded-[9999px]"), [ds.ROUND, ds.ROUND])
        self.assertEqual(px("rounded-[var(--radius)]"), [None])

    def test_words_that_are_not_classes(self):
        self.assertEqual(px("const isRounded = true; rounded_corner"), [])


class CssCorners(unittest.TestCase):
    def test_border_radius(self):
        self.assertEqual(px("border-radius: 4px;"), [4])
        self.assertEqual(px("border-radius: 2px 4px 50%;"), [2, 4, ds.ROUND])
        self.assertEqual(px("border-top-left-radius: 0.5rem;"), [8])
        self.assertEqual(px("border-radius: 5px !important;"), [5])
        self.assertEqual(px("border-radius: inherit;"), [])
        self.assertEqual(px('className="[border-radius:4px]"'), [4])
        self.assertEqual(px("border-radius: var(--m3-full);"), [None])

    def test_jsx_style(self):
        self.assertEqual(px("style={{ borderRadius: 9999 }}"), [ds.ROUND])
        self.assertEqual(px("style={{ borderRadius: '4px' }}"), [4])
        self.assertEqual(px("borderTopLeftRadius: 2,"), [2])


class LegacyRadii(unittest.TestCase):
    def test_zig_and_kotlin_still_parse(self):
        self.assertEqual(ds.radii("const CARD_RADIUS = 15;"), {15})
        self.assertEqual(ds.radii("shape = RoundedCornerShape(10.dp)"), {10})

    def test_tailwind_now_counts_as_live_code(self):
        self.assertEqual(ds.radii('<div className="rounded-md">'), {6})


class HypertaskPolicy(unittest.TestCase):
    def test_app_name_matches_policy(self):
        self.assertIn("hypertask", ds.APP_POLICY)
        self.assertNotIn("hypertasks", ds.APP_POLICY)

    def test_square_corners_pass(self):
        nodes = [{"path": "a", "radius": 4, "w": 120, "h": 32}, {"path": "b", "radius": 2, "w": 40, "h": 20}]
        self.assertEqual(ds.policy_frame_problems(nodes, HT), [])

    def test_circle_button_fails(self):
        nodes = [{"path": "Jump to top", "radius": 18, "w": 36, "h": 36}]
        self.assertEqual(len(ds.policy_frame_problems(nodes, HT)), 1)

    def test_tiny_circle_with_allowed_radius_fails(self):
        nodes = [{"path": "dot", "radius": 4, "w": 8, "h": 8}]
        self.assertIn("fully round", ds.policy_frame_problems(nodes, HT)[0])

    def test_pill_and_ellipse_fail(self):
        nodes = [{"path": "chip", "radius": 12, "w": 80, "h": 24}, {"path": "e", "type": "ELLIPSE", "w": 20, "h": 20}]
        self.assertEqual(len(ds.policy_frame_problems(nodes, HT)), 2)

    def test_mixed_corners_checked_each(self):
        nodes = [{"path": "panel", "radii": [4, 4, 8, 0], "w": 300, "h": 200}]
        self.assertIn("radius 8", ds.policy_frame_problems(nodes, HT)[0])

    def test_round_code_is_a_bug_not_precedent(self):
        bad = ds.policy_code_problems("src/Chat.tsx", '<button className="rounded-full p-2">', HT)
        self.assertEqual(len(bad), 1)
        self.assertIn("never copy it", bad[0])
        self.assertEqual(ds.policy_code_problems("src/Ok.tsx", '<b className="rounded-sm">', HT), [])


if __name__ == "__main__":
    unittest.main()
