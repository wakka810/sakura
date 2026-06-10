#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RuntimeInputState {
    pub click_count: u32,
    pub key_press_count: u32,
    pub pointer_x: u32,
    pub pointer_y: u32,
    pub pointer_button: u32,
    pub pointer_valid: bool,
    pub key_enter_down: bool,
    pub key_space_down: bool,
    pub key_up_down: bool,
    pub key_down_down: bool,
    pub key_left_down: bool,
    pub key_right_down: bool,
}
